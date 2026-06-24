"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { encryptSecret, decryptSecret, generateAesKeyB64, randomToken, sha256Hex } from "@/lib/crypto";
import { CoolifyClient } from "@/lib/coolify";
import { syncInstance } from "@/lib/discovery";
import { enqueueBackup, enqueueRestore, enqueuePrune, resolveDestination } from "@/lib/jobs";
import { isValidCron } from "@/lib/cron";
import { freqToCron } from "@/lib/schedule";
import { setTimezone, isValidTimezone } from "@/lib/settings";

function s(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

/* ----------------------------- settings ----------------------------- */

/** Set the app-wide IANA timezone used for schedules + timestamp display. */
export async function updateTimezone(fd: FormData) {
  await requireUser();
  const tz = s(fd, "timezone");
  if (!tz || !isValidTimezone(tz)) return { error: "Invalid timezone" };
  await setTimezone(tz);
  // Schedules + every page that shows times depend on this.
  revalidatePath("/", "layout");
  return { ok: true };
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
    data: { name, baseUrl, apiTokenEnc: encryptSecret(token) },
  });

  let warning: string | undefined;
  try {
    await syncInstance(instance.id);
  } catch (e) {
    warning = `Connected, but sync failed: ${(e as Error).message}`;
  }

  revalidatePath("/instances");
  revalidatePath("/resources");
  revalidatePath("/agents");
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Generate a fresh per-instance enrollment token and return the install
 * command containing it. The plaintext is shown to the operator exactly once:
 * only its sha256 hash + a masked hint are stored, so it can never be
 * re-displayed. Revealing again rotates the token, invalidating the previous
 * one (the agent on that host must then be reconfigured with the new command).
 */
export async function revealInstallCommand(
  instanceId: string,
): Promise<{ oneLiner: string; raw: string; hint: string }> {
  await requireUser();
  const token = "cbm_" + randomToken(24);
  const hint = `${token.slice(0, 8)}…${token.slice(-4)}`;
  await prisma.coolifyInstance.update({
    where: { id: instanceId },
    data: { enrollTokenHash: sha256Hex(token), enrollTokenHint: hint, enrollTokenSetAt: new Date() },
  });

  const base = (env.agentControllerUrl || env.authUrl).replace(/\/$/, "");
  const image = `${env.agentImage}:${env.agentImageTag}`;
  const oneLiner = `curl -fsSL ${base}/install.sh | CBM_TOKEN=${token} sh`;
  const raw = [
    "docker rm -f cbm-agent 2>/dev/null",
    "docker run -d --name cbm-agent --restart unless-stopped \\",
    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
    "  -v /backups:/backups \\",
    `  -e CONTROLLER_URL=${base} \\`,
    `  -e ENROLLMENT_TOKEN=${token} \\`,
    '  -e AGENT_HOSTNAME="$(hostname)" \\',
    `  ${image}`,
  ].join("\n");

  revalidatePath("/instances");
  return { oneLiner, raw, hint };
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
    // Local always writes to the agent host's persistent /backups volume
    // (mounted by the install command), so it survives agent recreation.
    config = { type: "local", basePath: "/backups" };
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
  const dest = await prisma.destination.findUnique({ where: { id } });
  if (dest) {
    // Delete the actual files first (via each owning instance's agent), grouped
    // by instance, before the records cascade away with the destination.
    const snaps = await prisma.snapshot.findMany({
      where: { destinationId: id },
      select: { destinationDir: true, resource: { select: { instanceId: true } } },
    });
    const byInstance = new Map<string | null, string[]>();
    for (const s of snaps) {
      const k = s.resource.instanceId;
      byInstance.set(k, [...(byInstance.get(k) ?? []), s.destinationDir]);
    }
    for (const [instanceId, dirs] of byInstance) {
      await enqueuePrune({ instanceId, destination: dest, dirs }).catch((e) =>
        console.warn("[delete-destination] prune failed", (e as Error).message),
      );
    }
  }
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

/** Delete a snapshot: removes its files from the destination (via the agent),
 * then drops the record. If no agent is online the record is still removed and
 * the files are left in place. */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  await requireUser();
  const snap = await prisma.snapshot.findUnique({
    where: { id: snapshotId },
    include: { destination: true, resource: true },
  });
  if (snap) {
    try {
      await enqueuePrune({
        instanceId: snap.resource.instanceId,
        destination: snap.destination,
        dirs: [snap.destinationDir],
      });
    } catch (e) {
      console.warn("[delete] file prune enqueue failed", (e as Error).message);
    }
  }
  await prisma.snapshot.delete({ where: { id: snapshotId } });
  revalidatePath("/snapshots");
  revalidatePath("/destinations");
  if (snap) revalidatePath(`/resources/${snap.resourceId}`);
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
      liveBackup: fd.get("liveBackup") === "on",
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
      liveBackup: fd.get("liveBackup") === "on",
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
  revalidatePath(`/snapshots/${snapshotId}`);
  return { ok: true, detail: target === "in_place" ? "Restore queued" : "Restore → new queued" };
}

/** Programmatic backup trigger (returns ids) for API/tests. */
export async function triggerBackup(resourceId: string) {
  await requireUser();
  return enqueueBackup(resourceId);
}
