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
import { dumpDatabase, dumpEngine } from "./dump.js";
import {
  tarVolume,
  pauseContainer,
  unpauseContainer,
  runningRwContainersForVolume,
  containerExists,
} from "./docker.js";
import { captureProvenance } from "./provenance.js";
import { encryptFile, sha256File } from "./crypto.js";
import { makeTransfer } from "./transfer.js";
import { resolveResource } from "./resolve.js";

export type Emit = (level: "debug" | "info" | "warn" | "error", message: string, progress?: number) => void;

export async function runBackup(job: BackupJob, workDir: string, emit: Emit): Promise<SnapshotManifest> {
  const stage = join(workDir, job.id);
  await mkdir(stage, { recursive: true });

  // Resolve concrete docker facts (containers/volumes/db creds) from the UUID
  // unless the controller already supplied them.
  const needsResolve =
    job.resource.volumes.length === 0 || (!job.resource.containerName && job.resource.containerNames.length === 0);
  const resource = needsResolve ? await resolveResource(job.resource) : job.resource;
  const liveBackup = job.liveBackup;
  const artifacts: Artifact[] = [];
  const isDb = DUMPABLE_DB_TYPES.includes(resource.type);
  const containers = resource.containerNames.length
    ? resource.containerNames
    : resource.containerName
      ? [resource.containerName]
      : [];
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
    const engine = dumpEngine(resource.type);
    const dumpName = dumpFileName(engine, resource.db?.database);
    const dumpPath = join(stage, dumpName);
    await dumpDatabase(resource.type, primary, resource.db ?? {}, dumpPath);
    artifacts.push(await finalizeArtifact("db-dump", dumpName, dumpPath, { engine }, job, stage, emit));
    captureMethod = "dump";
  } else {
    // Everything else (apps, services, non-dumpable DBs): copy each volume
    // WITHOUT ever stopping/recreating a container. For a consistent copy we
    // briefly freeze (docker pause) only the running containers that mount the
    // volume read-write — unless liveBackup is set, in which case we copy live.
    let i = 0;
    for (const vol of resource.volumes) {
      i++;
      const owners = liveBackup ? [] : await runningRwContainersForVolume(vol);
      const paused: string[] = [];
      try {
        for (const c of owners) {
          emit("info", `Freezing ${c} for a consistent copy of ${vol}`);
          await pauseContainer(c);
          paused.push(c);
        }
        if (liveBackup) {
          emit("warn", `Live copy of ${vol} without freezing (at your own risk) — may be inconsistent`);
        }
        emit("info", `Archiving volume ${vol} (${i}/${resource.volumes.length})`, 20 + (50 * i) / Math.max(1, resource.volumes.length));
        const name = volumeFileName(vol);
        const path = join(stage, name);
        await tarVolume(vol, path);
        artifacts.push(await finalizeArtifact("volume", name, path, { volume: vol }, job, stage, emit));
      } finally {
        for (const c of paused.reverse()) {
          emit("info", `Resuming ${c}`);
          await unpauseContainer(c).catch((e) => emit("error", `Failed to resume ${c}: ${(e as Error).message}`));
        }
      }
    }
    captureMethod = resource.volumes.length === 0 ? "none" : liveBackup ? "live" : "frozen";
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
    encrypted: job.encryption.enabled,
    destinationDir: job.destinationDir,
  };

  // Upload everything to the destination.
  emit("info", "Uploading to destination", 80);
  const transfer = await makeTransfer(job.destination);
  try {
    if (job.mode === "sync") {
      // Overwrite the single sync copy.
      await transfer.removeDir(job.destinationDir).catch(() => undefined);
    }
    for (const a of artifacts) {
      const local = join(stage, a.filename);
      await transfer.put(local, `${job.destinationDir}/${a.filename}`);
    }
    const manifestPath = join(stage, MANIFEST_FILE);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await transfer.put(manifestPath, `${job.destinationDir}/${MANIFEST_FILE}`);
  } finally {
    await transfer.close();
  }

  emit("info", "Backup complete", 100);
  await rm(stage, { recursive: true, force: true });
  return manifest;
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
