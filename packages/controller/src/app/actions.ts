"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { encryptSecret, decryptSecret, generateAesKeyB64, randomToken, sha256Hex } from "@/lib/crypto";
import { CoolifyClient } from "@/lib/coolify";
import { syncInstance } from "@/lib/discovery";
import { enqueueBackup, enqueueRestore, enqueuePrune, enqueueVerifyDestination, resolveDestination } from "@/lib/jobs";
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

/** Set (or clear) the webhook notified when a backup fails. */
export async function updateAlertWebhook(fd: FormData) {
  await requireUser();
  const url = s(fd, "alertWebhookUrl");
  if (url && !/^https?:\/\//i.test(url)) return { error: "Enter a valid http(s) URL, or leave blank to disable" };
  await prisma.setting.upsert({
    where: { id: "global" },
    create: { id: "global", alertWebhookUrl: url || null },
    update: { alertWebhookUrl: url || null },
  });
  revalidatePath("/settings");
  return { ok: true };
}

/** Send a test message to a webhook URL (without saving it). */
export async function testAlertWebhook(url: string) {
  await requireUser();
  if (!url || !/^https?:\/\//i.test(url)) return { error: "Enter a valid http(s) URL first" };
  const { sendTestAlert } = await import("@/lib/notify");
  const ok = await sendTestAlert(url);
  return ok ? { ok: true, detail: "Test notification sent" } : { error: "The webhook did not accept the message" };
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

/**
 * Pin an agent to a Coolify server (manual override), or clear it to re-enable
 * automatic detection. Used in multi-server instances where auto-detection is
 * ambiguous.
 */
export async function updateAgentServer(agentId: string, serverUuid: string | null) {
  await requireUser();
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { error: "Agent not found" };
  if (!serverUuid) {
    // Back to automatic detection.
    await prisma.agent.update({
      where: { id: agentId },
      data: { serverManual: false, serverUuid: null, serverName: null },
    });
  } else {
    // Resolve a friendly server name from a resource on that server.
    const sample = agent.instanceId
      ? await prisma.resource.findFirst({
          where: { instanceId: agent.instanceId, serverUuid },
          select: { serverName: true },
        })
      : null;
    await prisma.agent.update({
      where: { id: agentId },
      data: { serverManual: true, serverUuid, serverName: sample?.serverName ?? serverUuid },
    });
  }
  revalidatePath("/agents");
  revalidatePath("/instances");
  return { ok: true };
}

/* ----------------------------- destinations ----------------------------- */

export async function createDestination(fd: FormData) {
  await requireUser();
  const name = s(fd, "name");
  const type = s(fd, "type");
  if (!name || !type) return { error: "Name and type required" };
  // Storage engine: "restic" gives incremental/deduplicated/encrypted storage
  // (works over local, S3 and SSH/SFTP — including a jump host).
  const engine = s(fd, "engine") === "restic" ? "restic" : "tar";

  let config: unknown;
  if (type === "local") {
    // Local always writes to the agent host's persistent /backups volume
    // (mounted by the install command), so it survives agent recreation.
    config = { type: "local", basePath: "/backups" };
  } else if (type === "ssh") {
    const jumpHost = s(fd, "jumpHost");
    config = {
      type: "ssh",
      host: s(fd, "host"),
      port: Number(s(fd, "port") || "22"),
      username: s(fd, "username"),
      basePath: s(fd, "basePath"),
      password: s(fd, "password") || undefined,
      privateKey: s(fd, "privateKey") || undefined,
      // Optional bastion / jump host.
      ...(jumpHost
        ? {
            jumpHost,
            jumpPort: Number(s(fd, "jumpPort") || "22"),
            jumpUsername: s(fd, "jumpUsername") || undefined,
            jumpPassword: s(fd, "jumpPassword") || undefined,
            jumpPrivateKey: s(fd, "jumpPrivateKey") || undefined,
          }
        : {}),
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

  // restic encrypts its repository natively, so the optional AES layer is only
  // for the tar engine.
  const encryptionEnabled = engine === "tar" && fd.get("encryptionEnabled") === "on";
  await prisma.destination.create({
    data: {
      name,
      type,
      engine,
      configEnc: encryptSecret(JSON.stringify(config)),
      encryptionEnabled,
      encryptionKeyEnc: encryptionEnabled ? encryptSecret(generateAesKeyB64()) : null,
      // A strong random repo password, generated once and stored encrypted.
      resticPasswordEnc: engine === "restic" ? encryptSecret(generateAesKeyB64()) : null,
    },
  });
  revalidatePath("/destinations");
  return { ok: true };
}

export async function deleteDestination(id: string) {
  await requireUser();
  const dest = await prisma.destination.findUnique({ where: { id } });
  if (dest) {
    // Delete the actual files first, before the records cascade away with the
    // destination. For a "local" destination the files live on each producing
    // agent's host, so group by agent; ssh/s3 group by instance (any agent).
    const snaps = await prisma.snapshot.findMany({
      where: { destinationId: id },
      select: { destinationDir: true, agentId: true, resticSnapshotId: true, resource: { select: { instanceId: true } } },
    });
    const groups = new Map<
      string,
      { instanceId: string | null; agentId: string | null; dirs: string[]; resticSnapshotIds: string[] }
    >();
    for (const s of snaps) {
      const agentId = dest.type === "local" ? s.agentId : null;
      const key = dest.type === "local" ? `a:${agentId ?? ""}` : `i:${s.resource.instanceId ?? ""}`;
      const g = groups.get(key) ?? { instanceId: s.resource.instanceId, agentId, dirs: [], resticSnapshotIds: [] };
      g.dirs.push(s.destinationDir);
      if (s.resticSnapshotId) g.resticSnapshotIds.push(s.resticSnapshotId);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      await enqueuePrune({
        instanceId: g.instanceId,
        destination: dest,
        dirs: g.dirs,
        resticSnapshotIds: g.resticSnapshotIds,
        agentId: g.agentId,
      }).catch((e) => console.warn("[delete-destination] prune failed", (e as Error).message));
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
        resticSnapshotIds: snap.resticSnapshotId ? [snap.resticSnapshotId] : [],
        // For a "local" destination the files live on the producing agent's host.
        agentId: snap.destination.type === "local" ? snap.agentId : null,
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
  await prisma.backupPolicy.deleteMany({ where: { instanceId, resourceId: null, serverUuid: null } });
  revalidatePath("/instances");
}

/** Create/update the schedule for one server of a Coolify instance. */
export async function setServerSchedule(instanceId: string, serverUuid: string, fd: FormData) {
  await requireUser();
  const data = scheduleData(fd);
  if (!data.destinationId) return { error: "Pick a destination" };
  const instance = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const sample = await prisma.resource.findFirst({
    where: { instanceId, serverUuid },
    select: { serverName: true },
  });
  const serverName = sample?.serverName ?? serverUuid;
  const existing = await prisma.backupPolicy.findFirst({ where: { instanceId, serverUuid, resourceId: null } });
  if (existing) {
    await prisma.backupPolicy.update({ where: { id: existing.id }, data });
  } else {
    await prisma.backupPolicy.create({
      data: { ...data, name: `${instance.name} — ${serverName} schedule`, instanceId, serverUuid },
    });
  }
  revalidatePath("/instances");
  revalidatePath("/resources");
  return { ok: true };
}

export async function removeServerSchedule(instanceId: string, serverUuid: string): Promise<void> {
  await requireUser();
  await prisma.backupPolicy.deleteMany({ where: { instanceId, serverUuid, resourceId: null } });
  revalidatePath("/instances");
}

/** Manually reconcile a destination now (detect backups deleted at rest). */
export async function verifyDestinationNow(destinationId: string) {
  await requireUser();
  try {
    const { queued, reason } = await enqueueVerifyDestination(destinationId);
    if (queued === 0) {
      return {
        error:
          reason === "no-agent"
            ? "No agent online to run the check — start the agent on the host that holds these backups."
            : "Nothing to verify — this destination has no backups yet.",
      };
    }
    revalidatePath("/destinations");
    return { ok: true, detail: `Verifying destination (${queued} job${queued === 1 ? "" : "s"} queued)` };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
  // Setting a schedule on a resource implies it should be backed up.
  await prisma.resource.update({ where: { id: resourceId }, data: { backupEnabled: true } });
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

/** Update a resource's per-resource backup settings (auto-saved from the UI). */
export async function updateResourceSettings(resourceId: string, fd: FormData): Promise<void> {
  await requireUser();
  await prisma.resource.update({
    where: { id: resourceId },
    data: {
      backupEnabled: fd.get("backupEnabled") === "on",
      liveBackup: fd.get("liveBackup") === "on",
    },
  });
  revalidatePath("/resources");
  revalidatePath(`/resources/${resourceId}`);
}

/** Save a resource's per-container pre/post-backup hooks (empty entries dropped). */
export async function updateResourceHooks(
  resourceId: string,
  hooks: { container: string; pre?: string; post?: string }[],
) {
  await requireUser();
  const clean = (hooks ?? [])
    .map((h) => ({
      container: (h.container ?? "").trim(),
      pre: (h.pre ?? "").trim() || undefined,
      post: (h.post ?? "").trim() || undefined,
    }))
    .filter((h) => h.pre || h.post);
  await prisma.resource.update({
    where: { id: resourceId },
    data: { hooks: clean.length ? clean : Prisma.DbNull },
  });
  revalidatePath(`/resources/${resourceId}`);
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
