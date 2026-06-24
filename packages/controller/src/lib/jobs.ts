import {
  type BackupJob,
  type RestoreJob,
  type PruneJob,
  type ResolvedDestination,
  type EncryptionSpec,
  type SnapshotManifest,
  type ResourceDescriptor,
  type ResourceType,
  snapshotDir,
} from "@cbm/shared";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { effectivePolicy } from "./schedule";
import { CoolifyClient, type DbEngine, type CloneEngine } from "./coolify";
import { syncInstance } from "./discovery";
import type { Destination } from "@/generated/prisma/client";

const DUMP_ENGINES: DbEngine[] = ["postgresql", "mysql", "mariadb", "mongodb"];
const VOLUME_DB_ENGINES = ["redis", "keydb", "dragonfly", "clickhouse"];

/** Decrypt a destination's stored config into a ResolvedDestination. */
export function resolveDestination(dest: Destination): ResolvedDestination {
  return JSON.parse(decryptSecret(dest.configEnc)) as ResolvedDestination;
}

export function resolveEncryption(dest: Destination): EncryptionSpec {
  if (dest.encryptionEnabled && dest.encryptionKeyEnc) {
    return { enabled: true, key: decryptSecret(dest.encryptionKeyEnc) };
  }
  return { enabled: false };
}

/** Pick an agent to run jobs for a given Coolify instance. */
async function pickAgent(instanceId: string | null) {
  const forInstance = await prisma.agent.findFirst({
    where: { instanceId, status: "online" },
    orderBy: { lastSeenAt: "desc" },
  });
  if (forInstance) return forInstance;
  // Fall back to any agent linked to the instance, then any agent at all.
  return (
    (await prisma.agent.findFirst({ where: { instanceId } })) ??
    (await prisma.agent.findFirst({ orderBy: { lastSeenAt: "desc" } }))
  );
}

/** Create a Snapshot + queued AgentJob for a backup. */
export async function enqueueBackup(resourceId: string, policyId?: string, runId?: string) {
  const resource = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
  let policy = policyId
    ? await prisma.backupPolicy.findUniqueOrThrow({ where: { id: policyId }, include: { destination: true } })
    : null;

  // For a manual "Backup now", fall back to the resource's effective schedule
  // (resource override -> instance -> global) to pick destination + mode.
  if (!policy) {
    const eff = await effectivePolicy(resource.id);
    policy = eff.policy ?? null;
  }

  const dest = policy?.destination ?? (await prisma.destination.findFirst());
  if (!dest) throw new Error("No destination configured");

  const agent = await pickAgent(resource.instanceId);
  if (!agent) throw new Error("No agent available to run the job");

  const mode = (policy?.mode ?? "backup") as "backup" | "sync";
  const captureMode = resource.captureMode as "cold" | "hot";
  const iso = new Date().toISOString();
  const dir = snapshotDir(resource.coolifyUuid, mode, iso);

  // For real Coolify databases, read the dump credentials from the Coolify API
  // (authoritative) rather than relying on the container's env at backup time.
  const db = await dbCredsFor(resource);

  const snapshot = await prisma.snapshot.create({
    data: {
      resourceId: resource.id,
      policyId: policy?.id,
      destinationId: dest.id,
      mode,
      captureMode,
      status: "running",
      destinationDir: dir,
      runId,
    },
  });

  // Create the AgentJob first so its id can be used as the job correlation id
  // (agents post events/results to /api/agents/jobs/<agentJob.id>/...).
  const agentJob = await prisma.agentJob.create({
    data: {
      agentId: agent.id,
      type: "backup",
      status: "queued",
      payload: {},
      snapshotId: snapshot.id,
    },
  });

  const job: BackupJob = {
    id: agentJob.id,
    type: "backup",
    mode,
    captureMode,
    resource: {
      coolifyUuid: resource.coolifyUuid,
      name: resource.name,
      type: resource.type as BackupJob["resource"]["type"],
      containerName: resource.containerName ?? undefined,
      containerNames: resource.containerNames,
      volumes: resource.volumes,
      db,
    },
    destination: resolveDestination(dest),
    encryption: resolveEncryption(dest),
    destinationDir: dir,
  };

  await prisma.agentJob.update({ where: { id: agentJob.id }, data: { payload: job as unknown as object } });

  return { snapshotId: snapshot.id, agentId: agent.id, jobId: agentJob.id };
}

/**
 * Clone a resource into a brand-new Coolify resource (same project/env/server,
 * new name) for a "restore → new" so the original is never touched. Returns the
 * descriptor the agent will resolve + restore into.
 *
 *  - dump DBs (pg/mysql/maria/mongo) with a logical dump  -> created + deployed,
 *    the agent loads the dump into the running clone.
 *  - everything else (volume-based DBs, redis/keydb/..., apps, services)        ->
 *    created but NOT deployed; the agent pre-fills the remapped volumes so the
 *    data is present on the operator's first deploy. Apps pin the captured
 *    commit / image tag so the code matches the data.
 */
async function cloneForRestore(
  resource: { coolifyUuid: string; name: string; type: string; projectName: string; environment: string; instanceId: string },
  manifest: SnapshotManifest,
): Promise<ResourceDescriptor> {
  const instance = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: resource.instanceId } });
  const client = new CoolifyClient(instance.baseUrl, decryptSecret(instance.apiTokenEnc));
  const short = resource.coolifyUuid.slice(0, 4) + Date.now().toString(36).slice(-4);
  const newName = `${resource.name}-restored-${short}`.slice(0, 48);
  const projectName = resource.projectName;
  const environmentName = resource.environment || "production";
  const type = resource.type as ResourceType;
  const descriptor = (newUuid: string): ResourceDescriptor => ({
    coolifyUuid: newUuid,
    name: newName,
    type,
    containerNames: [],
    volumes: [],
  });

  let newUuid: string;
  if (DUMP_ENGINES.includes(resource.type as DbEngine)) {
    // Deploy only when there's a logical dump to load into a running container.
    const hasDump = (manifest.artifacts ?? []).some((a) => a.kind === "db-dump");
    newUuid = await client.cloneDatabase({
      sourceUuid: resource.coolifyUuid,
      type: resource.type as CloneEngine,
      newName,
      projectName,
      environmentName,
      instantDeploy: hasDump,
    });
    if (hasDump) await client.waitDatabaseRunning(newUuid);
  } else if (VOLUME_DB_ENGINES.includes(resource.type)) {
    // redis/keydb/dragonfly/clickhouse: volume-based, restore into the (not yet
    // deployed) clone's volumes.
    newUuid = await client.cloneDatabase({
      sourceUuid: resource.coolifyUuid,
      type: resource.type as CloneEngine,
      newName,
      projectName,
      environmentName,
      instantDeploy: false,
    });
  } else if (type === "application") {
    const sha = manifest.provenance?.gitCommitSha;
    newUuid = await client.cloneApplication({
      sourceUuid: resource.coolifyUuid,
      newName,
      projectName,
      environmentName,
      gitCommitSha: sha && sha !== "HEAD" ? sha : undefined,
      imageRef: manifest.provenance?.imageRef,
    });
    await client.copyEnvVars("applications", resource.coolifyUuid, newUuid).catch(() => 0);
  } else if (type === "service") {
    newUuid = await client.cloneService({
      sourceUuid: resource.coolifyUuid,
      newName,
      projectName,
      environmentName,
    });
    await client.copyEnvVars("services", resource.coolifyUuid, newUuid).catch(() => 0);
  } else {
    throw new Error(`Restore → new resource is not supported for type "${resource.type}"`);
  }

  // Surface the new resource in the controller UI.
  await syncInstance(instance.id).catch(() => undefined);
  return descriptor(newUuid);
}

/**
 * Map each captured volume name to the clone's volume name. Coolify derives
 * volume names from the resource uuid, so swapping the (dash-stripped) old uuid
 * for the new one yields the name the clone will mount on first deploy. Volumes
 * that don't carry the uuid are left unmapped (and the agent skips them).
 */
function buildVolumeMap(
  manifest: SnapshotManifest,
  oldUuid: string,
  newUuid: string,
): Record<string, string> | undefined {
  const o = oldUuid.replace(/-/g, "");
  const n = newUuid.replace(/-/g, "");
  const map: Record<string, string> = {};
  for (const a of manifest.artifacts ?? []) {
    if (a.kind !== "volume") continue;
    const v = a.meta?.volume;
    if (!v || !v.includes(o)) continue;
    map[v] = v.split(o).join(n);
  }
  return Object.keys(map).length ? map : undefined;
}

const FLOATING_TAGS = ["latest", "main", "master", "stable", "edge", "nightly"];

/**
 * When a docker-image resource ran a floating tag (latest/…), Coolify can't pin
 * the clone to the exact digest (its image field is "name:tag", no digest), so
 * we tell the operator the exact image captured at backup so they can pin it.
 */
function imagePinNote(manifest: SnapshotManifest): string | undefined {
  const ref = manifest.provenance?.imageRef;
  const digest = manifest.provenance?.imageDigest;
  if (!ref || ref.includes("@") || !digest || !digest.includes("@sha256:")) return undefined;
  const tag = ref.split(":").pop();
  if (!tag || !FLOATING_TAGS.includes(tag.toLowerCase())) return undefined;
  return (
    `The image tag was floating ("${tag}"), so the clone is pinned to "${tag}" — Coolify docker-image apps can't store a ` +
    `digest. The exact image at backup time was ${digest}; pin it manually if you need an identical reproduction.`
  );
}

/** Authoritative dump/restore DB credentials from the Coolify API (the
 * container env isn't always reliable). undefined for non-DB / coolify-self. */
async function dbCredsFor(resource: {
  type: string;
  coolifyUuid: string;
  instanceId: string;
}): Promise<{ user?: string; password?: string; database?: string } | undefined> {
  if (!DUMP_ENGINES.includes(resource.type as DbEngine) || resource.coolifyUuid.startsWith("coolify-self")) {
    return undefined;
  }
  const instance = await prisma.coolifyInstance.findUnique({ where: { id: resource.instanceId } });
  if (!instance) return undefined;
  const client = new CoolifyClient(instance.baseUrl, decryptSecret(instance.apiTokenEnc));
  return client.getDbCredentials(resource.coolifyUuid, resource.type as DbEngine).catch(() => undefined);
}

/** Create a RestoreJob + queued AgentJob from an existing snapshot. */
export async function enqueueRestore(snapshotId: string, target: "in_place" | "new_resource" = "in_place") {
  const snapshot = await prisma.snapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { destination: true, resource: true },
  });
  if (!snapshot.manifest) throw new Error("Snapshot has no manifest; cannot restore");

  const agent = await pickAgent(snapshot.resource.instanceId);
  if (!agent) throw new Error("No agent available to run the restore");

  const enc = resolveEncryption(snapshot.destination);
  const manifest = snapshot.manifest as unknown as SnapshotManifest;

  // "→ new": clone into a fresh Coolify resource and restore into it. The
  // volume map tells the agent which (uuid-swapped) volumes to fill.
  let targetResource: ResourceDescriptor | undefined;
  let volumeMap: Record<string, string> | undefined;
  let note: string | undefined;
  if (target === "new_resource") {
    targetResource = await cloneForRestore(snapshot.resource, manifest);
    volumeMap = buildVolumeMap(manifest, snapshot.resource.coolifyUuid, targetResource.coolifyUuid);
    note = imagePinNote(manifest);
  }

  const restore = await prisma.restoreJob.create({
    data: { snapshotId: snapshot.id, target, status: "running" },
  });

  const agentJob = await prisma.agentJob.create({
    data: {
      agentId: agent.id,
      type: "restore",
      status: "queued",
      payload: {},
      restoreId: restore.id,
    },
  });

  const job: RestoreJob = {
    id: agentJob.id,
    type: "restore",
    manifest,
    source: resolveDestination(snapshot.destination),
    decryptionKey: enc.enabled ? enc.key : undefined,
    target,
    targetResource,
    volumeMap,
    note,
    // Same DB keeps its name/creds in the clone, so the original's creds work.
    db: await dbCredsFor(snapshot.resource),
  };

  await prisma.agentJob.update({ where: { id: agentJob.id }, data: { payload: job as unknown as object } });

  return { restoreId: restore.id, agentId: agent.id, jobId: agentJob.id };
}

/**
 * Queue an agent job to delete backup directories from a destination. The agent
 * is the one with access to the files (local lives on its host; ssh/s3 are
 * reachable from it). Returns null when no live agent can run it.
 */
export async function enqueuePrune(opts: {
  instanceId: string | null;
  destination: Destination;
  dirs: string[];
}): Promise<{ jobId: string; agentId: string } | null> {
  const dirs = opts.dirs.filter(Boolean);
  if (dirs.length === 0) return null;
  const agent = await pickAgent(opts.instanceId);
  if (!agent) return null;

  const agentJob = await prisma.agentJob.create({
    data: { agentId: agent.id, type: "prune", status: "queued", payload: {} },
  });
  const job: PruneJob = {
    id: agentJob.id,
    type: "prune",
    destination: resolveDestination(opts.destination),
    dirs,
  };
  await prisma.agentJob.update({ where: { id: agentJob.id }, data: { payload: job as unknown as object } });
  return { jobId: agentJob.id, agentId: agent.id };
}
