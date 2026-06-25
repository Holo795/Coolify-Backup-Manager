import { spawn } from "node:child_process";
import { readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { ResolvedDestination } from "@cbm/shared";

let RESTIC = "restic";
export function setResticBin(bin: string) {
  RESTIC = bin;
}

export interface ResticRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Everything needed to run restic against one destination: the repo URL + auth
 * env, any global `-o` args (the SFTP backend command for ssh destinations), and
 * a cleanup that removes the temp key/password files. Build once per job, run
 * all restic commands with it, then `cleanup()`.
 */
export interface ResticCtx {
  env: NodeJS.ProcessEnv;
  args: string[];
  cleanup: () => Promise<void>;
}

/** Quote a token for restic's shell-string splitter (used inside sftp.command). */
function q(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

const SSH_OPTS = (knownHosts: string) => [
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  `UserKnownHostsFile=${knownHosts}`,
  "-o",
  "ConnectTimeout=20",
];

export async function resticContext(dest: ResolvedDestination, password: string): Promise<ResticCtx> {
  const env: NodeJS.ProcessEnv = { ...process.env, RESTIC_PASSWORD: password };

  if (dest.type === "local") {
    env.RESTIC_REPOSITORY = `${dest.basePath.replace(/\/$/, "")}/restic-repo`;
    return { env, args: [], cleanup: async () => {} };
  }

  if (dest.type === "s3") {
    const ep = dest.endpoint ? dest.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "") : "s3.amazonaws.com";
    const prefix = dest.prefix ? `${dest.prefix.replace(/^\/|\/$/g, "")}/` : "";
    env.RESTIC_REPOSITORY = `s3:${dest.endpoint ? `https://${ep}` : ep}/${dest.bucket}/${prefix}restic-repo`;
    env.AWS_ACCESS_KEY_ID = dest.accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = dest.secretAccessKey;
    env.AWS_DEFAULT_REGION = dest.region || "us-east-1";
    return { env, args: [], cleanup: async () => {} };
  }

  // ssh / sftp: restic's sftp backend shells out to ssh. We build a full ssh
  // command (key via -i, password via sshpass -f, bastion via a nested
  // ProxyCommand) and hand it to restic as `-o sftp.command=…`.
  const tmp = await mkdtemp(join(tmpdir(), "cbm-restic-"));
  const written: string[] = [];
  const secretFile = async (name: string, content: string, withNewline: boolean) => {
    const p = join(tmp, name);
    await writeFile(p, withNewline && !content.endsWith("\n") ? `${content}\n` : content, { mode: 0o600 });
    written.push(p);
    return p;
  };
  const knownHosts = await secretFile("known_hosts", "", false);

  // Build the auth prefix (sshpass) + key option for one hop.
  const hop = async (tag: string, key?: string, pwd?: string): Promise<{ prefix: string[]; keyOpt: string[] }> => {
    const prefix: string[] = [];
    const keyOpt: string[] = [];
    if (key) keyOpt.push("-i", await secretFile(`key_${tag}`, key, true));
    if (pwd) prefix.push("sshpass", "-f", await secretFile(`pw_${tag}`, pwd, false));
    return { prefix, keyOpt };
  };

  let proxy: string[] = [];
  if (dest.jumpHost) {
    const j = await hop("jump", dest.jumpPrivateKey || dest.privateKey, dest.jumpPassword || dest.password);
    const jumpCmd = [
      ...j.prefix,
      "ssh",
      ...j.keyOpt,
      ...SSH_OPTS(knownHosts),
      "-W",
      "%h:%p",
      "-p",
      String(dest.jumpPort),
      `${dest.jumpUsername || dest.username}@${dest.jumpHost}`,
    ].join(" ");
    proxy = ["-o", `ProxyCommand=${jumpCmd}`];
  }

  const t = await hop("target", dest.privateKey, dest.password);
  const sftpTokens = [
    ...t.prefix,
    "ssh",
    ...t.keyOpt,
    ...SSH_OPTS(knownHosts),
    ...proxy,
    "-p",
    String(dest.port),
    `${dest.username}@${dest.host}`,
    "-s",
    "sftp",
  ];
  const sftpCommand = sftpTokens.map(q).join(" ");

  env.RESTIC_REPOSITORY = `sftp:${dest.username}@${dest.host}:${posix.join(dest.basePath, "restic-repo")}`;
  return {
    env,
    args: ["-o", `sftp.command=${sftpCommand}`],
    cleanup: async () => {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      void written;
    },
  };
}

/** Run a restic command, buffering stdout/stderr. Global ctx args come first. */
export function restic(ctx: ResticCtx, args: string[]): Promise<ResticRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(RESTIC, [...ctx.args, ...args], { env: ctx.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d) => (stdout += d.toString()));
    child.stderr!.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// Serialise repo initialisation per repository so concurrent jobs (the agent
// runs several at once) don't race to `restic init` a brand-new repo.
const ensuring = new Map<string, Promise<void>>();

/** Initialise the repo if it doesn't exist yet (idempotent, race-safe). */
export async function resticEnsureRepo(ctx: ResticCtx): Promise<void> {
  const repo = ctx.env.RESTIC_REPOSITORY ?? "";
  const existing = ensuring.get(repo);
  if (existing) return existing;
  const p = (async () => {
    const check = await restic(ctx, ["cat", "config", "--no-lock"]);
    if (check.code === 0) return;
    const init = await restic(ctx, ["init"]);
    if (init.code !== 0 && !/already initialized|already exists|config already/i.test(init.stderr)) {
      throw new Error(`restic init failed: ${init.stderr.slice(0, 500)}`);
    }
  })().finally(() => ensuring.delete(repo));
  ensuring.set(repo, p);
  return p;
}

/**
 * Back up a staging directory into the repo, tagged so it can be found later.
 * Returns the new restic snapshot id.
 */
export async function resticBackupDir(ctx: ResticCtx, dir: string, tags: string[]): Promise<string> {
  const args = ["backup", dir, "--host", "cbm", "--json"];
  for (const t of tags) args.push("--tag", t);
  const r = await restic(ctx, args);
  if (r.code !== 0) throw new Error(`restic backup failed: ${r.stderr.slice(0, 500)}`);
  for (const line of r.stdout.split("\n").reverse()) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const obj = JSON.parse(s);
      if (obj.message_type === "summary" && obj.snapshot_id) return obj.snapshot_id as string;
    } catch {
      /* ignore non-JSON lines */
    }
  }
  throw new Error("restic backup did not report a snapshot id");
}

/**
 * Restore a specific restic snapshot id into targetRoot; returns the directory
 * that holds the restored manifest.json (restic recreates the original absolute
 * paths under the target, so we locate the manifest by scanning).
 */
export async function resticRestoreById(ctx: ResticCtx, snapshotId: string, targetRoot: string): Promise<string> {
  const r = await restic(ctx, ["restore", snapshotId, "--target", targetRoot]);
  if (r.code !== 0) throw new Error(`restic restore failed: ${r.stderr.slice(0, 500)}`);
  const found = await findManifestDir(targetRoot);
  if (!found) throw new Error("restic restore produced no manifest.json");
  return found;
}

/** Forget specific snapshots by id and prune freed data. */
export async function resticForget(ctx: ResticCtx, snapshotIds: string[]): Promise<void> {
  if (snapshotIds.length === 0) return;
  const r = await restic(ctx, ["forget", ...snapshotIds, "--prune"]);
  if (r.code !== 0) throw new Error(`restic forget failed: ${r.stderr.slice(0, 500)}`);
}

/** List all snapshot ids currently in the repo (full + short ids). */
export async function resticListSnapshotIds(ctx: ResticCtx): Promise<Set<string>> {
  const r = await restic(ctx, ["snapshots", "--no-lock", "--json"]);
  if (r.code !== 0) throw new Error(`restic snapshots failed: ${r.stderr.slice(0, 300)}`);
  const ids = new Set<string>();
  try {
    for (const s of JSON.parse(r.stdout) as Array<{ id?: string; short_id?: string }>) {
      if (s.short_id) ids.add(s.short_id);
      if (s.id) ids.add(s.id);
    }
  } catch {
    /* empty repo prints [] */
  }
  return ids;
}

/** Recursively find the directory containing a manifest.json under root. */
async function findManifestDir(root: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name === "manifest.json") return root;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = await findManifestDir(join(root, e.name));
      if (found) return found;
    }
  }
  return null;
}
