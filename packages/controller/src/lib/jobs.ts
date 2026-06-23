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
import { CoolifyClient, type DbEngine } from "./coolify";
import { syncInstance } from "./discovery";
import type { Destination } from "@/generated/prisma/client";

const DUMP_ENGINES: DbEngine[] = ["postgresql", "mysql", "mariadb", "mongodb"];

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
export async function enqueueBackup(resourceId: string, policyId?: string) {
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

  const snapshot = await prisma.snapshot.create({
    data: {
      resourceId: resource.id,
      policyId: policy?.id,
      destinationId: dest.id,
      mode,
      captureMode,
      status: "running",
      destinationDir: dir,
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
 * descriptor the agent will resolve + restore into. DB engines only for now.
 */
async function cloneForRestore(
  resource: { coolifyUuid: string; name: string; type: string; projectName: string; environment: string; instanceId: string },
): Promise<ResourceDescriptor> {
  const instance = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: resource.instanceId } });
  const client = new CoolifyClient(instance.baseUrl, decryptSecret(instance.apiTokenEnc));
  const short = resource.coolifyUuid.slice(0, 4) + Date.now().toString(36).slice(-4);
  const newName = `${resource.name}-restored-${short}`.slice(0, 48);

  if (DUMP_ENGINES.includes(resource.type as DbEngine)) {
    const newUuid = await client.cloneDatabase({
      sourceUuid: resource.coolifyUuid,
      type: resource.type as DbEngine,
      newName,
      projectName: resource.projectName,
      environmentName: resource.environment || "production",
    });
    await client.waitDatabaseRunning(newUuid);
    // Surface the new resource in the controller UI.
    await syncInstance(instance.id).catch(() => undefined);
    return {
      coolifyUuid: newUuid,
      name: newName,
      type: resource.type as ResourceType,
      containerNames: [],
      volumes: [],
    };
  }

  throw new Error(
    `Restore → new resource for "${resource.type}" is not available yet (databases work today; ` +
      `compose/services and apps are coming next).`,
  );
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

  // "→ new": clone into a fresh Coolify resource and restore into it.
  const targetResource = target === "new_resource" ? await cloneForRestore(snapshot.resource) : undefined;

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
    manifest: snapshot.manifest as unknown as SnapshotManifest,
    source: resolveDestination(snapshot.destination),
    decryptionKey: enc.enabled ? enc.key : undefined,
    target,
    targetResource,
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
