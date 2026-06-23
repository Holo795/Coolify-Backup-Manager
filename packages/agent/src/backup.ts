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
  stopContainer,
  startContainer,
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
  const captureMode = job.captureMode;
  const artifacts: Artifact[] = [];
  const isDb = DUMPABLE_DB_TYPES.includes(resource.type);
  const containers = resource.containerNames.length
    ? resource.containerNames
    : resource.containerName
      ? [resource.containerName]
      : [];

  emit("info", `Starting ${job.mode} (${captureMode}) of ${resource.name} [${resource.type}]`, 2);

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
  } else if (captureMode === "hot" && isDb) {
    // Logical dump, no downtime.
    if (!primary) throw new Error("Hot DB backup requires a container name");
    emit("info", `Dumping database via ${resource.type}`, 20);
    const engine = dumpEngine(resource.type);
    const dumpName = dumpFileName(engine, resource.db?.database);
    const dumpPath = join(stage, dumpName);
    await dumpDatabase(resource.type, primary, resource.db ?? {}, dumpPath);
    artifacts.push(
      await finalizeArtifact("db-dump", dumpName, dumpPath, { engine }, job, stage, emit),
    );
  } else {
    // Cold capture (default & only path for non-dumpable types): stop -> tar -> start.
    const stopped: string[] = [];
    try {
      if (captureMode === "cold") {
        for (const c of containers) {
          if (await containerExists(c)) {
            emit("info", `Stopping container ${c}`);
            await stopContainer(c);
            stopped.push(c);
          }
        }
      } else {
        emit("warn", `Hot capture of non-DB resource: volumes are tarred live and may be inconsistent`);
      }
      let i = 0;
      for (const vol of resource.volumes) {
        i++;
        emit("info", `Archiving volume ${vol} (${i}/${resource.volumes.length})`, 20 + (50 * i) / Math.max(1, resource.volumes.length));
        const name = volumeFileName(vol);
        const path = join(stage, name);
        await tarVolume(vol, path);
        artifacts.push(
          await finalizeArtifact("volume", name, path, { volume: vol }, job, stage, emit),
        );
      }
    } finally {
      for (const c of stopped.reverse()) {
        emit("info", `Restarting container ${c}`);
        await startContainer(c).catch((e) => emit("error", `Failed to restart ${c}: ${(e as Error).message}`));
      }
    }
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
    captureMode,
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
