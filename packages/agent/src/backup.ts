import { mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type Artifact,
  type BackupJob,
  type Provenance,
  type SnapshotManifest,
  DUMPABLE_DB_TYPES,
  dumpFileName,
  volumeFileName,
  MANIFEST_FILE,
  CONFIG_FILE,
} from "@cbm/shared";
import { dumpDatabase, dumpRedis } from "./dump.js";
import { REDIS_ENGINES, isRedisEngine, type Engine } from "./engines.js";
import {
  tarVolume,
  pauseContainer,
  unpauseContainer,
  runningRwContainersForVolume,
  isContainerRunning,
  verifyTarOpens,
  containerExists,
  execShell,
} from "./docker.js";
import { captureProvenance } from "./provenance.js";
import { encryptFile, sha256File } from "./crypto.js";
import { makeTransfer } from "./transfer.js";
import { resticEnsureRepo, resticBackupDir, withResticCtx } from "./restic.js";
import { resolveResource, findDbContainers, readDbCredentials, resourceContainers } from "./resolve.js";

export type Emit = (level: "debug" | "info" | "warn" | "error", message: string, progress?: number) => void;

export async function runBackup(job: BackupJob, workDir: string, emit: Emit): Promise<SnapshotManifest> {
  const stage = join(workDir, job.id);
  await mkdir(stage, { recursive: true });

  // Always resolve concrete docker facts from the UUID: it fills in what the
  // controller didn't cache (notably bind mounts, which aren't cached) and keeps
  // anything already provided.
  const resource = await resolveResource(job.resource);
  const liveBackup = job.liveBackup;
  const artifacts: Artifact[] = [];
  const isDb = DUMPABLE_DB_TYPES.includes(resource.type);
  const containers = resourceContainers(resource);
  // What the agent actually did, recorded in the manifest for display.
  let captureMethod = "none";

  emit("info", `Starting ${job.mode} of ${resource.name} [${resource.type}]`, 2);

  // Provenance (best-effort) from the primary container.
  let provenance: Provenance = {};
  const primary = resource.containerName ?? containers[0];
  if (primary && (await containerExists(primary))) {
    try {
      provenance = await captureProvenance(primary);
      emit("debug", `Provenance: ${JSON.stringify(provenance)}`);
    } catch (e) {
      emit("warn", `Provenance capture failed: ${(e as Error).message}`);
    }
  }

  const isCoolifySelf = resource.coolifyUuid.startsWith("coolify-self");
  const isRedisStandalone = REDIS_ENGINES.includes(resource.type as Engine);

  // Copy every named volume + host-path (bind) mount WITHOUT stopping a
  // container: briefly freeze (docker pause) only the running container(s) that
  // write to each one, unless liveBackup is set. Returns the capture method.
  const copyVolumesAndBinds = async (): Promise<string> => {
    // Named volumes and host-path (bind) mounts are archived the same way; they
    // only differ in what to freeze and the artifact meta. Normalise both into a
    // single list so the freeze/archive/resume dance lives in one loop.
    // `tarVolume` mounts the given path, so it works for host bind sources too.
    const targets: Array<{
      source: string;
      fileName: string;
      label: string;
      meta: Record<string, string>;
      freezeContainers: () => Promise<string[]>;
    }> = [
      ...resource.volumes.map((vol) => ({
        source: vol,
        fileName: volumeFileName(vol),
        label: `volume ${vol}`,
        meta: { volume: vol },
        freezeContainers: () => runningRwContainersForVolume(vol),
      })),
      ...resource.bindMounts.map((b) => ({
        source: b.source,
        fileName: volumeFileName("bind-" + b.source.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")),
        label: `host folder ${b.source}`,
        meta: { bindSource: b.source },
        freezeContainers: async () => ((await isContainerRunning(b.container)) ? [b.container] : []),
      })),
    ];

    const total = targets.length;
    let i = 0;
    for (const t of targets) {
      i++;
      const owners = liveBackup ? [] : await t.freezeContainers();
      const paused: string[] = [];
      try {
        for (const c of owners) {
          emit("info", `Freezing ${c} for a consistent copy of ${t.source}`);
          await pauseContainer(c);
          paused.push(c);
        }
        if (liveBackup) emit("warn", `Live copy of ${t.source} without freezing (at your own risk) — may be inconsistent`);
        emit("info", `Archiving ${t.label} (${i}/${total})`, 20 + (50 * i) / Math.max(1, total));
        const path = join(stage, t.fileName);
        await tarVolume(t.source, path);
        await verifyTarOpens(path);
        artifacts.push(await finalizeArtifact("volume", t.fileName, path, t.meta, job, stage, emit));
      } finally {
        for (const c of paused.reverse()) {
          emit("info", `Resuming ${c}`);
          await unpauseContainer(c).catch((e) => emit("error", `Failed to resume ${c}: ${(e as Error).message}`));
        }
      }
    }
    return total === 0 ? "none" : liveBackup ? "live" : "frozen";
  };

  // Logical dump of one DB container (SQL via pg_dump/mysqldump/…, Redis via an
  // RDB export). Returns the artifact, or null if it couldn't be produced.
  const dumpContainer = async (
    container: string,
    engine: Engine,
    meta: Record<string, string>,
    progress: number,
  ): Promise<Artifact | null> => {
    try {
      if (isRedisEngine(engine)) {
        const creds = await readDbCredentials(container, engine);
        const name = `dump-${engine}-${container}.rdb`.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const path = join(stage, name);
        emit("info", `Exporting ${engine} (${container}) via RDB — no freeze`, progress);
        await dumpRedis(container, creds?.password, path);
        return await finalizeArtifact("db-dump", name, path, { engine, container, ...meta }, job, stage, emit);
      }
      const creds = await readDbCredentials(container, engine);
      const name = `dump-${engine}-${container}.sql`.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = join(stage, name);
      emit("info", `Dumping ${engine} (${container}) — no downtime`, progress);
      await dumpDatabase(engine, container, creds ?? {}, path);
      return await finalizeArtifact("db-dump", name, path, { engine, container, ...meta }, job, stage, emit);
    } catch (e) {
      emit("warn", `Logical export of ${container} (${engine}) failed: ${(e as Error).message}`);
      return null;
    }
  };

  // Resolve a hook's target container: the named one if it exists, else the
  // resource's primary container.
  const hooks = job.hooks ?? [];
  const hookContainer = async (name: string): Promise<string | undefined> =>
    name && (await containerExists(name)) ? name : primary;

  try {
  // Pre-backup hooks: run inside their container(s); a failure aborts the backup
  // (the operator wanted the app quiesced first). They run INSIDE the try so the
  // post hooks (finally below) still run to undo them — e.g. bring an app back
  // out of maintenance even when a pre hook or the backup failed.
  for (const h of hooks) {
    if (!h.pre) continue;
    const c = await hookContainer(h.container);
    if (!c) {
      emit("warn", `No container for pre-backup hook (${h.container || "primary"}); skipped`);
      continue;
    }
    emit("info", `Running pre-backup hook in ${c}`, 5);
    const r = await execShell(c, h.pre);
    if (r.code !== 0) throw new Error(`pre-backup hook failed in ${c} (exit ${r.code}): ${r.stderr.slice(0, 300)}`);
  }

  if (isCoolifySelf) {
    // Coolify control plane: logical dump of its Postgres + live tar of /data/coolify.
    if (!primary) throw new Error("Coolify self-backup could not locate the Coolify database container");
    emit("info", `Dumping Coolify database`, 20);
    const dumpName = dumpFileName("postgresql", resource.db?.database);
    const dumpPath = join(stage, dumpName);
    await dumpDatabase("postgresql", primary, resource.db ?? {}, dumpPath);
    artifacts.push(await finalizeArtifact("db-dump", dumpName, dumpPath, { engine: "postgresql" }, job, stage, emit));
    let i = 0;
    for (const vol of resource.volumes) {
      i++;
      emit("info", `Archiving Coolify data volume ${vol}`, 40 + 30 * (i / Math.max(1, resource.volumes.length)));
      const name = volumeFileName(vol);
      const path = join(stage, name);
      await tarVolume(vol, path);
      artifacts.push(await finalizeArtifact("volume", name, path, { volume: vol }, job, stage, emit));
    }
    captureMethod = "dump+live";
  } else if (isDb) {
    // Standalone database: always a logical dump while running — no downtime,
    // no restart, application-consistent.
    if (!primary) throw new Error("Database backup requires a container name");
    emit("info", `Dumping database via ${resource.type} (no downtime)`, 20);
    const engine = resource.type;
    const dumpName = dumpFileName(engine, resource.db?.database);
    const dumpPath = join(stage, dumpName);
    await dumpDatabase(resource.type, primary, resource.db ?? {}, dumpPath);
    artifacts.push(await finalizeArtifact("db-dump", dumpName, dumpPath, { engine }, job, stage, emit));
    captureMethod = "dump";
  } else if (isRedisStandalone) {
    // Standalone Redis/KeyDB/Dragonfly: prefer a logical RDB export (no freeze,
    // portable). Fall back to a frozen volume copy if the CLI isn't available.
    const dataVolume = resource.volumes[0] ?? "";
    const art =
      primary && (await containerExists(primary))
        ? await dumpContainer(primary, resource.type as Engine, { volume: dataVolume }, 20)
        : null;
    if (art) {
      artifacts.push(art);
      captureMethod = "dump";
    } else {
      emit("warn", `Falling back to a frozen volume copy for ${resource.type}`);
      captureMethod = await copyVolumesAndBinds();
    }
  } else {
    // Apps & services: capture every volume + bind mount (no restart), AND give
    // any database living inside the resource (e.g. the Postgres in a compose
    // service) a logical export on top — application-consistent and restorable
    // across engine versions. The volume copy is kept so "→ new" still works.
    const dbs = await findDbContainers(containers);
    let dumped = 0;
    for (const db of dbs) {
      const art = await dumpContainer(db.container, db.engine, { volume: db.volumes[0] ?? "" }, 15);
      if (art) {
        artifacts.push(art);
        dumped++;
      }
    }
    const volMethod = await copyVolumesAndBinds();
    captureMethod = dumped > 0 ? `dump+${volMethod}` : volMethod;
  }

  // Config artifact (resource descriptor + provenance) — sensitive, encrypt if enabled.
  const config = { resource, provenance };
  const configPath = join(stage, CONFIG_FILE);
  await writeFile(configPath, JSON.stringify(config, null, 2));
  artifacts.push(await finalizeArtifact("config", CONFIG_FILE, configPath, {}, job, stage, emit));

  // Strip DB credentials from the manifest — it is stored unencrypted on the
  // destination. Credentials are re-resolved from the live container at restore.
  const { db: _omitDb, ...sanitizedResource } = resource;
  const manifest: SnapshotManifest = {
    version: 1,
    resource: sanitizedResource,
    mode: job.mode,
    captureMode: captureMethod,
    capturedAt: new Date().toISOString(),
    artifacts,
    provenance,
    envEnc: job.envEnc,
    encrypted: job.encryption.enabled,
    destinationDir: job.destinationDir,
  };

  // Persist the manifest into the staging dir (it's part of what gets stored).
  const manifestPath = join(stage, MANIFEST_FILE);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  if (job.storage.engine === "restic") {
    // Incremental, deduplicated, encrypted: restic backs up the whole staging
    // dir; only changed blocks are uploaded. The repo encrypts at rest.
    emit("info", "Storing in restic repository (incremental)", 80);
    if (!job.storage.resticPassword) throw new Error("restic engine selected but no repository password provided");
    await withResticCtx(job.destination, job.storage.resticPassword, async (ctx) => {
      await resticEnsureRepo(ctx);
      const snapId = await resticBackupDir(ctx, stage, [`snap:${job.id}`, `res:${resource.coolifyUuid}`]);
      manifest.resticSnapshotId = snapId;
      // Re-write the manifest with the id so a local copy reflects reality.
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      emit("info", `Stored as restic snapshot ${snapId}`, 95);
    });
  } else {
    // tar engine: one file per artifact at the destination.
    emit("info", "Uploading to destination", 80);
    const transfer = await makeTransfer(job.destination);
    try {
      if (job.mode === "sync") {
        await transfer.removeDir(job.destinationDir).catch(() => undefined);
      }
      for (const a of artifacts) {
        const local = join(stage, a.filename);
        await transfer.put(local, `${job.destinationDir}/${a.filename}`);
      }
      await transfer.put(manifestPath, `${job.destinationDir}/${MANIFEST_FILE}`);

      // Verify every artifact actually landed (catches a truncated upload).
      emit("info", "Verifying backup at the destination", 95);
      const present = new Set(await transfer.list(job.destinationDir).catch(() => []));
      const missing = [...artifacts.map((a) => a.filename), MANIFEST_FILE].filter(
        (f) => !present.has(`${job.destinationDir}/${f}`),
      );
      if (missing.length) throw new Error(`Backup verification failed: missing at destination: ${missing.join(", ")}`);
    } finally {
      await transfer.close();
    }
  }

  emit("info", "Backup complete", 100);
  return manifest;
  } finally {
    // Post-backup hooks always run (e.g. bring an app back out of maintenance),
    // best-effort, then clean the staging dir.
    for (const h of hooks) {
      if (!h.post) continue;
      const c = await hookContainer(h.container);
      if (!c) continue;
      emit("info", `Running post-backup hook in ${c}`);
      const r = await execShell(c, h.post).catch((e) => ({ code: -1, stdout: "", stderr: (e as Error).message }));
      if (r.code !== 0) emit("warn", `post-backup hook failed in ${c} (exit ${r.code}): ${r.stderr.slice(0, 300)}`);
    }
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Compute size + sha256, optionally encrypt, return the Artifact record. */
async function finalizeArtifact(
  kind: Artifact["kind"],
  baseName: string,
  path: string,
  meta: Record<string, string>,
  job: BackupJob,
  stage: string,
  emit: Emit,
): Promise<Artifact> {
  const sha = await sha256File(path);
  let filename = baseName;
  let finalPath = path;
  let encrypted = false;

  if (job.encryption.enabled) {
    if (!job.encryption.key) throw new Error("Encryption enabled but no key provided");
    filename = `${baseName}.enc`;
    finalPath = join(stage, filename);
    await encryptFile(path, finalPath, job.encryption.key);
    encrypted = true;
    emit("debug", `Encrypted ${baseName} -> ${filename}`);
  }

  const size = (await stat(finalPath)).size;
  return { kind, filename, sizeBytes: size, sha256: sha, encrypted, meta };
}
