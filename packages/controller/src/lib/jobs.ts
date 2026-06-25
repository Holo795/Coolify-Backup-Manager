import {
  type BackupJob,
  type RestoreJob,
  type PruneJob,
  type ResolvedDestination,
  type EncryptionSpec,
  type SnapshotManifest,
  type ResourceDescriptor,
  type ResourceType,
  type StorageSpec,
  snapshotDir,
} from "@cbm/shared";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
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
  // restic encrypts the repository natively, so artifacts are never double-encrypted.
  if (dest.engine === "restic") return { enabled: false };
  if (dest.encryptionEnabled && dest.encryptionKeyEnc) {
    return { enabled: true, key: decryptSecret(dest.encryptionKeyEnc) };
  }
  return { enabled: false };
}

/** Storage engine + secrets for a destination (tar files vs a restic repo). */
export function resolveStorage(dest: Destination): StorageSpec {
  if (dest.engine === "restic") {
    if (!dest.resticPasswordEnc) throw new Error(`Destination "${dest.name}" uses restic but has no repository password`);
    return { engine: "restic", resticPassword: decryptSecret(dest.resticPasswordEnc) };
  }
  return { engine: "tar" };
}

/**
 * Pick the agent that should run a job for a resource on `serverUuid` of a
 * Coolify instance. An agent only sees its own host's Docker, so in a
 * multi-server instance the job MUST go to the agent on the resource's server.
 * Priority:
 *   1. an online agent whose serverUuid matches the resource's server;
 *   2. if the server is unknown (null) → any online agent of the instance
 *      (legacy / single-server behaviour);
 *   3. if exactly one online agent serves the instance → use it (single-server
 *      convenience, e.g. before auto-detection has run);
 *   4. otherwise null — the caller raises a clear "no agent on server X" error.
 */
async function pickAgent(instanceId: string | null, serverUuid?: string | null) {
  if (serverUuid) {
    const onServer = await prisma.agent.findFirst({
      where: { instanceId, status: "online", serverUuid },
      orderBy: { lastSeenAt: "desc" },
    });
    if (onServer) return onServer;
  }

  const online = await prisma.agent.findMany({
    where: { instanceId, status: "online" },
    orderBy: { lastSeenAt: "desc" },
  });
  if (!serverUuid) {
    // Unknown server: keep legacy behaviour (any online agent of the instance,
    // then any agent at all).
    return (
      online[0] ??
      (await prisma.agent.findFirst({ where: { instanceId } })) ??
      (await prisma.agent.findFirst({ orderBy: { lastSeenAt: "desc" } }))
    );
  }
  // Server known but no agent matched it: only safe to fall back when there's a
  // single online agent (it can only be the one host). Otherwise refuse rather
  // than back up on the wrong server.
  if (online.length === 1) return online[0];
  return null;
}

/** Fetch a specific agent by id (used to target the producer of a snapshot). */
async function agentById(agentId: string | null | undefined) {
  if (!agentId) return null;
  return prisma.agent.findUnique({ where: { id: agentId } });
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

  const agent = await pickAgent(resource.instanceId, resource.serverUuid);
  if (!agent) {
    throw new Error(
      `No online agent on server "${resource.serverName ?? resource.serverUuid}" to back up ${resource.name}. ` +
        `Install the agent on that server.`,
    );
  }

  const mode = (policy?.mode ?? "backup") as "backup" | "sync";
  const liveBackup = resource.liveBackup;
  // Descriptive label of how it will be captured (the agent confirms it in the
  // manifest). Databases are dumped live; everything else is frozen-then-copied
  // unless the operator opted into a live (no-freeze) copy.
  const isDumpable = DUMP_ENGINES.includes(resource.type as DbEngine);
  const captureMode = isDumpable ? "dump" : liveBackup ? "live" : "frozen";
  const iso = new Date().toISOString();
  const dir = snapshotDir(resource.instanceId, resource.coolifyUuid, mode, iso);

  // For real Coolify databases, read the dump credentials from the Coolify API
  // (authoritative) rather than relying on the container's env at backup time.
  const db = await dbCredsFor(resource);
  // Capture env vars (apps/services) into the snapshot so it's self-contained.
  const envEnc = await envEncFor(resource);

  const snapshot = await prisma.snapshot.create({
    data: {
      resourceId: resource.id,
      policyId: policy?.id,
      destinationId: dest.id,
      agentId: agent.id,
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
    liveBackup,
    envEnc,
    resource: {
      coolifyUuid: resource.coolifyUuid,
      name: resource.name,
      type: resource.type as BackupJob["resource"]["type"],
      containerName: resource.containerName ?? undefined,
      containerNames: resource.containerNames,
      volumes: resource.volumes,
      bindMounts: [], // the agent re-resolves bind mounts from Docker
      db,
    },
    destination: resolveDestination(dest),
    encryption: resolveEncryption(dest),
    storage: resolveStorage(dest),
    hooks:
      resource.preBackupHook || resource.postBackupHook
        ? { pre: resource.preBackupHook ?? undefined, post: resource.postBackupHook ?? undefined }
        : undefined,
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
  // The clone usually keeps the source type, but a floating-tag docker-image app
  // is cloned as a digest-pinned service (see cloneApplication), so track it.
  let clonedType: ResourceType = type;
  const descriptor = (newUuid: string): ResourceDescriptor => ({
    coolifyUuid: newUuid,
    name: newName,
    type: clonedType,
    containerNames: [],
    volumes: [],
    bindMounts: [],
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
    const cloned = await client.cloneApplication({
      sourceUuid: resource.coolifyUuid,
      newName,
      projectName,
      environmentName,
      gitCommitSha: sha && sha !== "HEAD" ? sha : undefined,
      imageRef: manifest.provenance?.imageRef,
      imageDigest: manifest.provenance?.imageDigest,
    });
    newUuid = cloned.uuid;
    clonedType = cloned.type;
    // Env from the snapshot if present (autonomous), else live from the original.
    await applyEnv(
      client,
      manifest,
      cloned.type === "service" ? "services" : "applications",
      newUuid,
      "applications",
      resource.coolifyUuid,
    );
  } else if (type === "service") {
    newUuid = await client.cloneService({
      sourceUuid: resource.coolifyUuid,
      newName,
      projectName,
      environmentName,
    });
    await applyEnv(client, manifest, "services", newUuid, "services", resource.coolifyUuid);
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

/** Capture an app/service's env vars from Coolify, master-key-encrypted, so the
 * snapshot is self-contained. undefined for other types, coolify-self, or none. */
async function envEncFor(resource: { type: string; coolifyUuid: string; instanceId: string }): Promise<string | undefined> {
  const kind = resource.type === "application" ? "applications" : resource.type === "service" ? "services" : null;
  if (!kind || resource.coolifyUuid.startsWith("coolify-self")) return undefined;
  const instance = await prisma.coolifyInstance.findUnique({ where: { id: resource.instanceId } });
  if (!instance) return undefined;
  const client = new CoolifyClient(instance.baseUrl, decryptSecret(instance.apiTokenEnc));
  const envs = await client.getEnvVars(kind, resource.coolifyUuid).catch(() => []);
  return envs.length ? encryptSecret(JSON.stringify(envs)) : undefined;
}

/** Set env on the cloned resource from the snapshot (self-contained) when
 * available, else copy live from the still-present original. */
async function applyEnv(
  client: CoolifyClient,
  manifest: SnapshotManifest,
  destKind: "applications" | "services",
  newUuid: string,
  srcKind: "applications" | "services",
  srcUuid: string,
): Promise<void> {
  if (manifest.envEnc) {
    try {
      const envs = JSON.parse(decryptSecret(manifest.envEnc)) as Array<Record<string, unknown>>;
      await client.setEnvVars(destKind, newUuid, envs);
      return;
    } catch {
      /* fall back to live copy below */
    }
  }
  await client.copyEnvVars(srcKind, srcUuid, destKind, newUuid).catch(() => 0);
}

/** Create a RestoreJob + queued AgentJob from an existing snapshot. */
export async function enqueueRestore(snapshotId: string, target: "in_place" | "new_resource" = "in_place") {
  const snapshot = await prisma.snapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { destination: true, resource: true },
  });
  if (!snapshot.manifest) throw new Error("Snapshot has no manifest; cannot restore");

  // Prefer the agent that produced this snapshot (its files live on that host
  // for a "local" destination); otherwise route to an agent on the resource's
  // server.
  const producer = await agentById(snapshot.agentId);
  const agent =
    producer && producer.status === "online"
      ? producer
      : await pickAgent(snapshot.resource.instanceId, snapshot.resource.serverUuid);
  if (!agent) {
    throw new Error(
      `No online agent on server "${snapshot.resource.serverName ?? snapshot.resource.serverUuid}" ` +
        `to restore ${snapshot.resource.name}.`,
    );
  }

  const enc = resolveEncryption(snapshot.destination);
  const manifest = snapshot.manifest as unknown as SnapshotManifest;

  // "→ new": clone into a fresh Coolify resource and restore into it. The
  // volume map tells the agent which (uuid-swapped) volumes to fill.
  let targetResource: ResourceDescriptor | undefined;
  let volumeMap: Record<string, string> | undefined;
  if (target === "new_resource") {
    targetResource = await cloneForRestore(snapshot.resource, manifest);
    volumeMap = buildVolumeMap(manifest, snapshot.resource.coolifyUuid, targetResource.coolifyUuid);
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
    storage: resolveStorage(snapshot.destination),
    resticSnapshotId: snapshot.resticSnapshotId ?? undefined,
    decryptionKey: enc.enabled ? enc.key : undefined,
    target,
    targetResource,
    volumeMap,
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
  /** restic snapshot ids to forget (restic engine). */
  resticSnapshotIds?: string[];
  /** Target a specific agent (the producer) — required for a "local" destination
   * whose files live on that agent's host. */
  agentId?: string | null;
}): Promise<{ jobId: string; agentId: string } | null> {
  const isRestic = opts.destination.engine === "restic";
  const dirs = opts.dirs.filter(Boolean);
  const resticSnapshotIds = (opts.resticSnapshotIds ?? []).filter(Boolean);
  if (isRestic ? resticSnapshotIds.length === 0 : dirs.length === 0) return null;
  const agent = (await agentById(opts.agentId)) ?? (await pickAgent(opts.instanceId));
  if (!agent) return null;

  const agentJob = await prisma.agentJob.create({
    data: { agentId: agent.id, type: "prune", status: "queued", payload: {} },
  });
  const job: PruneJob = {
    id: agentJob.id,
    type: "prune",
    destination: resolveDestination(opts.destination),
    storage: resolveStorage(opts.destination),
    dirs,
    resticSnapshotIds,
  };
  await prisma.agentJob.update({ where: { id: agentJob.id }, data: { payload: job as unknown as object } });
  return { jobId: agentJob.id, agentId: agent.id };
}

/** Any online agent (for jobs against a globally-reachable ssh/s3 destination). */
async function anyOnlineAgent() {
  return prisma.agent.findFirst({ where: { status: "online" }, orderBy: { lastSeenAt: "desc" } });
}

/**
 * Reconcile a destination: ask an agent to list it and report which snapshots'
 * files are still present. A snapshot whose files are gone is later flagged
 * "missing" + alerted (see the verify branch in the job result route).
 *
 *  - ssh/s3: one job to any online agent (the destination is reachable anywhere).
 *  - local: the files live on each producing agent's host, so one job per agent,
 *    each only covering the snapshots it wrote, routed to that exact agent.
 *
 * Returns how many verify jobs were queued.
 */
export async function enqueueVerifyDestination(
  destinationId: string,
): Promise<{ queued: number; reason?: "empty" | "no-agent" }> {
  const dest = await prisma.destination.findUnique({ where: { id: destinationId } });
  if (!dest) return { queued: 0, reason: "empty" };

  const isRestic = dest.engine === "restic";
  // Re-check both healthy and already-missing snapshots (so a backup whose files
  // reappear can flip back to succeeded). restic needs the snapshot id.
  const snaps = await prisma.snapshot.findMany({
    where: {
      destinationId,
      status: { in: ["succeeded", "missing"] },
      ...(isRestic ? { resticSnapshotId: { not: null } } : {}),
    },
    select: { destinationDir: true, agentId: true, resticSnapshotId: true },
  });
  if (snaps.length === 0) return { queued: 0, reason: "empty" };

  const resolved = resolveDestination(dest);
  const storage = resolveStorage(dest);

  // Group by the agent that must run the check. A "local" destination (tar or
  // restic) lives on each producing agent's host; ssh/s3 are reachable anywhere.
  const groups = new Map<string | null, typeof snaps>();
  if (dest.type === "local") {
    for (const s of snaps) {
      const key = s.agentId ?? null;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
  } else {
    groups.set("__any__" as unknown as string, snaps);
  }

  let queued = 0;
  for (const [key, groupSnaps] of groups) {
    if (groupSnaps.length === 0) continue;
    let agent;
    if (key === ("__any__" as unknown as string)) agent = await anyOnlineAgent();
    else if (key === null) {
      console.warn(`[verify] ${groupSnaps.length} local snapshot(s) on destination ${dest.name} have no known agent; skipped`);
      continue;
    } else agent = await agentById(key);
    if (!agent) {
      console.warn(`[verify] no agent available to check destination ${dest.name} (group ${String(key)})`);
      continue;
    }

    const agentJob = await prisma.agentJob.create({
      data: { agentId: agent.id, type: "verify-destination", status: "queued", payload: {} },
    });
    const job = {
      id: agentJob.id,
      type: "verify-destination" as const,
      destination: resolved,
      storage,
      dirs: groupSnaps.map((s) => s.destinationDir),
      resticSnapshotIds: isRestic
        ? groupSnaps.map((s) => s.resticSnapshotId).filter((x): x is string => !!x)
        : undefined,
      // Extra (ignored by the agent's parse) so the result route knows which
      // destination + engine these results belong to.
      destinationId,
      engine: dest.engine,
    };
    await prisma.agentJob.update({ where: { id: agentJob.id }, data: { payload: job as unknown as object } });
    queued++;
  }
  // Snapshots existed but nothing could be queued → no agent able to reach them.
  return queued === 0 ? { queued, reason: "no-agent" } : { queued };
}
