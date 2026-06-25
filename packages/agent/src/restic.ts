import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
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

/** Build the restic repository URL + auth env for a destination. */
export function resticEnv(dest: ResolvedDestination, password: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, RESTIC_PASSWORD: password };
  if (dest.type === "local") {
    env.RESTIC_REPOSITORY = `${dest.basePath.replace(/\/$/, "")}/restic-repo`;
  } else if (dest.type === "s3") {
    const ep = dest.endpoint ? dest.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "") : "s3.amazonaws.com";
    const prefix = dest.prefix ? `${dest.prefix.replace(/^\/|\/$/g, "")}/` : "";
    env.RESTIC_REPOSITORY = `s3:${dest.endpoint ? `https://${ep}` : ep}/${dest.bucket}/${prefix}restic-repo`;
    env.AWS_ACCESS_KEY_ID = dest.accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = dest.secretAccessKey;
    env.AWS_DEFAULT_REGION = dest.region || "us-east-1";
  } else {
    throw new Error(`restic engine does not support "${dest.type}" destinations`);
  }
  return env;
}

/** Run a restic command, buffering stdout/stderr. */
export function restic(args: string[], env: NodeJS.ProcessEnv): Promise<ResticRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(RESTIC, args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
export async function resticEnsureRepo(env: NodeJS.ProcessEnv): Promise<void> {
  const repo = env.RESTIC_REPOSITORY ?? "";
  const existing = ensuring.get(repo);
  if (existing) return existing;
  const p = (async () => {
    const check = await restic(["cat", "config", "--no-lock"], env);
    if (check.code === 0) return;
    const init = await restic(["init"], env);
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
export async function resticBackupDir(env: NodeJS.ProcessEnv, dir: string, tags: string[]): Promise<string> {
  const args = ["backup", dir, "--host", "cbm", "--json"];
  for (const t of tags) args.push("--tag", t);
  const r = await restic(args, env);
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
export async function resticRestoreById(env: NodeJS.ProcessEnv, snapshotId: string, targetRoot: string): Promise<string> {
  const r = await restic(["restore", snapshotId, "--target", targetRoot], env);
  if (r.code !== 0) throw new Error(`restic restore failed: ${r.stderr.slice(0, 500)}`);
  const found = await findManifestDir(targetRoot);
  if (!found) throw new Error("restic restore produced no manifest.json");
  return found;
}

/** Forget specific snapshots by id and prune freed data. */
export async function resticForget(env: NodeJS.ProcessEnv, snapshotIds: string[]): Promise<void> {
  if (snapshotIds.length === 0) return;
  const r = await restic(["forget", ...snapshotIds, "--prune"], env);
  if (r.code !== 0) throw new Error(`restic forget failed: ${r.stderr.slice(0, 500)}`);
}

/** List all snapshot ids currently in the repo (short ids). */
export async function resticListSnapshotIds(env: NodeJS.ProcessEnv): Promise<Set<string>> {
  const r = await restic(["snapshots", "--no-lock", "--json"], env);
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
