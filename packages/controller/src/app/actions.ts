"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { encryptSecret, decryptSecret, generateAesKeyB64, randomToken } from "@/lib/crypto";
import { CoolifyClient } from "@/lib/coolify";
import { syncInstance } from "@/lib/discovery";
import { enqueueBackup, enqueueRestore, resolveDestination } from "@/lib/jobs";
import { isValidCron } from "@/lib/cron";
import { freqToCron } from "@/lib/schedule";

/** Deploy (or redeploy) the agent for an instance via the Coolify API. */
async function deployAgentForInstance(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  const instance = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const client = new CoolifyClient(instance.baseUrl, decryptSecret(instance.apiTokenEnc));
  await prisma.coolifyInstance.update({ where: { id: instanceId }, data: { agentDeployStatus: "deploying" } });
  try {
    const { uuid } = await client.deployAgent({
      image: env.agentImage,
      tag: env.agentImageTag,
      controllerUrl: env.agentControllerUrl || env.authUrl,
      enrollToken: instance.enrollToken,
      existingUuid: instance.agentResourceUuid ?? undefined,
    });
    await prisma.coolifyInstance.update({
      where: { id: instanceId },
      data: { agentResourceUuid: uuid, agentDeployStatus: "deployed" },
    });
    return { ok: true };
  } catch (e) {
    await prisma.coolifyInstance.update({ where: { id: instanceId }, data: { agentDeployStatus: "failed" } });
    return { ok: false, error: (e as Error).message };
  }
}

function s(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

/* ----------------------------- instances ----------------------------- */

export async function connectInstance(fd: FormData) {
  await requireUser();
  const name = s(fd, "name");
  const baseUrl = s(fd, "baseUrl").replace(/\/$/, "");
  const token = s(fd, "apiToken");
  if (!name || !baseUrl || !token) return { error: "All fields are required" };

  const ping = await new CoolifyClient(baseUrl, token).ping();
  if (!ping.ok) return { error: `Cannot reach Coolify: ${ping.error}` };

  const instance = await prisma.coolifyInstance.create({
    data: { name, baseUrl, apiTokenEnc: encryptSecret(token), enrollToken: randomToken() },
  });

  let warning: string | undefined;
  try {
    await syncInstance(instance.id);
  } catch (e) {
    warning = `Connected, but sync failed: ${(e as Error).message}`;
  }

  // Zero-config: auto-deploy the agent on this instance's host when requested.
  if (fd.get("autoDeploy") === "on") {
    const dep = await deployAgentForInstance(instance.id);
    if (!dep.ok) {
      warning = `${warning ? warning + " " : ""}Agent auto-deploy failed: ${dep.error}. You can retry from the instance card.`;
    }
  }

  revalidatePath("/instances");
  revalidatePath("/resources");
  revalidatePath("/agents");
  return warning ? { ok: true, warning } : { ok: true };
}

export async function deployAgentAction(instanceId: string): Promise<void> {
  await requireUser();
  await deployAgentForInstance(instanceId);
  revalidatePath("/instances");
  revalidatePath("/agents");
}

export async function regenerateEnrollToken(instanceId: string): Promise<void> {
  await requireUser();
  await prisma.coolifyInstance.update({ where: { id: instanceId }, data: { enrollToken: randomToken() } });
  revalidatePath("/instances");
}

/** Back up the Coolify control plane itself (its Postgres + /data/coolify). */
export async function backupCoolifyInstance(instanceId: string) {
  await requireUser();
  const inst = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const resource = await prisma.resource.upsert({
    where: { instanceId_coolifyUuid: { instanceId, coolifyUuid: `coolify-self-${instanceId}` } },
    create: {
      instanceId,
      coolifyUuid: `coolify-self-${instanceId}`,
      name: `${inst.name} (control plane)`,
      type: "postgresql",
      projectName: "Coolify",
      status: "running:healthy",
      captureMode: "hot",
      backupEnabled: true,
    },
    update: {},
  });
  try {
    await enqueueBackup(resource.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/instances");
  revalidatePath("/snapshots");
  return { ok: true, detail: "Coolify backup queued" };
}

export async function syncInstanceAction(instanceId: string): Promise<void> {
  await requireUser();
  try {
    await syncInstance(instanceId);
  } catch (e) {
    console.error("[sync] failed", (e as Error).message);
  }
  revalidatePath("/resources");
  revalidatePath("/instances");
}

export async function deleteInstance(instanceId: string) {
  await requireUser();
  await prisma.coolifyInstance.delete({ where: { id: instanceId } });
  revalidatePath("/instances");
  revalidatePath("/resources");
}

/* ----------------------------- agents ----------------------------- */

export async function linkAgent(agentId: string, instanceId: string) {
  await requireUser();
  await prisma.agent.update({
    where: { id: agentId },
    data: { instanceId: instanceId || null },
  });
  revalidatePath("/agents");
}

export async function deleteAgent(agentId: string) {
  await requireUser();
  await prisma.agent.delete({ where: { id: agentId } });
  revalidatePath("/agents");
}

/* ----------------------------- destinations ----------------------------- */

export async function createDestination(fd: FormData) {
  await requireUser();
  const name = s(fd, "name");
  const type = s(fd, "type");
  if (!name || !type) return { error: "Name and type required" };

  let config: unknown;
  if (type === "local") {
    config = { type: "local", basePath: s(fd, "basePath") };
  } else if (type === "ssh") {
    config = {
      type: "ssh",
      host: s(fd, "host"),
      port: Number(s(fd, "port") || "22"),
      username: s(fd, "username"),
      basePath: s(fd, "basePath"),
      password: s(fd, "password") || undefined,
      privateKey: s(fd, "privateKey") || undefined,
    };
  } else if (type === "s3") {
    config = {
      type: "s3",
      endpoint: s(fd, "endpoint") || undefined,
      region: s(fd, "region") || "us-east-1",
      bucket: s(fd, "bucket"),
      prefix: s(fd, "prefix"),
      accessKeyId: s(fd, "accessKeyId"),
      secretAccessKey: s(fd, "secretAccessKey"),
      forcePathStyle: fd.get("forcePathStyle") === "on",
    };
  } else {
    return { error: "Unknown destination type" };
  }

  const encryptionEnabled = fd.get("encryptionEnabled") === "on";
  await prisma.destination.create({
    data: {
      name,
      type,
      configEnc: encryptSecret(JSON.stringify(config)),
      encryptionEnabled,
      encryptionKeyEnc: encryptionEnabled ? encryptSecret(generateAesKeyB64()) : null,
    },
  });
  revalidatePath("/destinations");
  return { ok: true };
}

export async function deleteDestination(id: string) {
  await requireUser();
  await prisma.destination.delete({ where: { id } });
  revalidatePath("/destinations");
}

export async function testDestinationAction(id: string) {
  await requireUser();
  const dest = await prisma.destination.findUniqueOrThrow({ where: { id } });
  const { testDestination } = await import("@/lib/destination-test");
  const result = await testDestination(resolveDestination(dest));
  return result;
}

/* ----------------------------- jobs: cancel / retry ----------------------------- */

/** Cancel a snapshot's job if it's still queued (not yet picked up). */
export async function cancelSnapshot(snapshotId: string): Promise<void> {
  await requireUser();
  const job = await prisma.agentJob.findFirst({ where: { snapshotId, status: "queued" } });
  if (job) {
    await prisma.agentJob.update({ where: { id: job.id }, data: { status: "failed", error: "cancelled", finishedAt: new Date() } });
    await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: "failed", error: "cancelled", finishedAt: new Date() } });
  }
  revalidatePath("/snapshots");
}

/** Re-pin a Git app to the commit captured in a snapshot, then redeploy. */
export async function repinDeployment(snapshotId: string): Promise<{ ok?: boolean; error?: string; detail?: string }> {
  await requireUser();
  const snap = await prisma.snapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { resource: { include: { instance: true } } },
  });
  const manifest = snap.manifest as { provenance?: { gitCommitSha?: string } } | null;
  const sha = manifest?.provenance?.gitCommitSha;
  if (!sha || sha === "HEAD") return { error: "This snapshot has no concrete commit to re-pin to" };
  const inst = snap.resource.instance;
  const client = new CoolifyClient(inst.baseUrl, decryptSecret(inst.apiTokenEnc));
  try {
    await client.repinCommit(snap.resource.coolifyUuid, sha);
    return { ok: true, detail: `Re-pinned to ${sha.slice(0, 8)} and redeploying` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Retry a failed backup by re-enqueuing its resource. */
export async function retrySnapshot(snapshotId: string): Promise<void> {
  await requireUser();
  const snap = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  try {
    await enqueueBackup(snap.resourceId);
  } catch (e) {
    console.error("[retry] failed", (e as Error).message);
  }
  revalidatePath("/snapshots");
}

/* ----------------------------- policies ----------------------------- */

export async function createPolicy(fd: FormData) {
  await requireUser();
  const name = s(fd, "name");
  const cron = s(fd, "cron") || "0 2 * * *";
  const destinationId = s(fd, "destinationId");
  if (!name || !destinationId) return { error: "Name and destination required" };
  if (!isValidCron(cron)) return { error: "Invalid cron expression" };

  await prisma.backupPolicy.create({
    data: {
      name,
      mode: s(fd, "mode") || "backup",
      cron,
      destinationId,
      resourceId: s(fd, "resourceId") || null,
      retentionDaily: Number(s(fd, "retentionDaily") || "7"),
      retentionWeekly: Number(s(fd, "retentionWeekly") || "4"),
      retentionMonthly: Number(s(fd, "retentionMonthly") || "6"),
    },
  });
  revalidatePath("/policies");
  return { ok: true };
}

export async function deletePolicy(id: string) {
  await requireUser();
  await prisma.backupPolicy.delete({ where: { id } });
  revalidatePath("/policies");
}

/* ------------------------- schedules (inheritance) ------------------------- */

function scheduleData(fd: FormData) {
  return {
    cron: freqToCron(s(fd, "frequency") || "daily", s(fd, "customCron")),
    mode: s(fd, "mode") || "backup",
    destinationId: s(fd, "destinationId"),
    retentionDaily: Number(s(fd, "retentionDaily") || "7"),
    retentionWeekly: Number(s(fd, "retentionWeekly") || "4"),
    retentionMonthly: Number(s(fd, "retentionMonthly") || "6"),
  };
}

/** Create/update the default schedule for a whole Coolify instance. */
export async function setInstanceSchedule(instanceId: string, fd: FormData) {
  await requireUser();
  const data = scheduleData(fd);
  if (!data.destinationId) return { error: "Pick a destination" };
  const instance = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const existing = await prisma.backupPolicy.findFirst({ where: { instanceId, resourceId: null } });
  if (existing) {
    await prisma.backupPolicy.update({ where: { id: existing.id }, data });
  } else {
    await prisma.backupPolicy.create({ data: { ...data, name: `${instance.name} schedule`, instanceId } });
  }
  revalidatePath("/instances");
  revalidatePath("/resources");
  return { ok: true };
}

export async function removeInstanceSchedule(instanceId: string): Promise<void> {
  await requireUser();
  await prisma.backupPolicy.deleteMany({ where: { instanceId, resourceId: null } });
  revalidatePath("/instances");
}

/** Create/update a per-resource override schedule. */
export async function setResourceSchedule(resourceId: string, fd: FormData) {
  await requireUser();
  const data = scheduleData(fd);
  if (!data.destinationId) return { error: "Pick a destination" };
  const resource = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
  const existing = await prisma.backupPolicy.findFirst({ where: { resourceId } });
  if (existing) {
    await prisma.backupPolicy.update({ where: { id: existing.id }, data });
  } else {
    await prisma.backupPolicy.create({ data: { ...data, name: `${resource.name} override`, resourceId } });
  }
  revalidatePath(`/resources/${resourceId}`);
  return { ok: true };
}

/** Drop a resource override so it inherits its instance schedule again. */
export async function removeResourceOverride(resourceId: string): Promise<void> {
  await requireUser();
  await prisma.backupPolicy.deleteMany({ where: { resourceId } });
  revalidatePath(`/resources/${resourceId}`);
}

/* ----------------------------- resources ----------------------------- */

export async function updateResourceSettings(resourceId: string, fd: FormData): Promise<void> {
  await requireUser();
  await prisma.resource.update({
    where: { id: resourceId },
    data: {
      backupEnabled: fd.get("backupEnabled") === "on",
      excluded: fd.get("excluded") === "on",
      captureMode: s(fd, "captureMode") || "cold",
    },
  });
  revalidatePath("/resources");
  revalidatePath(`/resources/${resourceId}`);
}

/** Capture mode + exclusion for a resource (used by the resource detail page). */
export async function setResourceOptions(resourceId: string, fd: FormData) {
  await requireUser();
  await prisma.resource.update({
    where: { id: resourceId },
    data: {
      captureMode: s(fd, "captureMode") || "cold",
      excluded: fd.get("excluded") === "on",
      backupEnabled: true,
    },
  });
  revalidatePath(`/resources/${resourceId}`);
  revalidatePath("/resources");
  return { ok: true };
}

export async function backupNow(resourceId: string): Promise<{ ok?: boolean; error?: string; detail?: string }> {
  await requireUser();
  try {
    await enqueueBackup(resourceId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/snapshots");
  revalidatePath(`/resources/${resourceId}`);
  return { ok: true, detail: "Backup queued" };
}

export async function restoreSnapshot(
  snapshotId: string,
  target: "in_place" | "new_resource",
): Promise<{ ok?: boolean; error?: string; detail?: string }> {
  await requireUser();
  try {
    await enqueueRestore(snapshotId, target);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/snapshots");
  return { ok: true, detail: target === "in_place" ? "Restore queued" : "Restore → new queued" };
}

/** Programmatic backup trigger (returns ids) for API/tests. */
export async function triggerBackup(resourceId: string) {
  await requireUser();
  return enqueueBackup(resourceId);
}
