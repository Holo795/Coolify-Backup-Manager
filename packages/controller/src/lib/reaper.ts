import { prisma } from "./prisma";
import { notifyBackupFailed } from "./notify";
import { AGENT_ONLINE_MS } from "./agent-status";

export interface ReaperOptions {
  /** Mark an agent offline after this long without a heartbeat. */
  offlineMs?: number;
  /** Fail a running job whose agent went silent for this long. */
  stuckMs?: number;
}

/**
 * Housekeeping: mark silent agents offline and fail jobs/snapshots that have
 * been "running" too long (agent died mid-job). Idempotent; safe to run often.
 */
export async function reaper(now = new Date(), opts: ReaperOptions = {}): Promise<{ offline: number; stuck: number }> {
  const offlineMs = opts.offlineMs ?? AGENT_ONLINE_MS;
  const stuckMs = opts.stuckMs ?? 30 * 60_000;

  const offline = await prisma.agent.updateMany({
    where: { status: "online", lastSeenAt: { lt: new Date(now.getTime() - offlineMs) } },
    data: { status: "offline" },
  });

  const stuckJobs = await prisma.agentJob.findMany({
    where: { status: "running", claimedAt: { lt: new Date(now.getTime() - stuckMs) } },
  });
  for (const j of stuckJobs) {
    await prisma.agentJob.update({
      where: { id: j.id },
      data: { status: "failed", error: "agent timed out", finishedAt: now },
    });
    if (j.snapshotId) {
      const upd = await prisma.snapshot.updateMany({
        where: { id: j.snapshotId, status: "running" },
        data: { status: "failed", error: "agent timed out", finishedAt: now },
      });
      if (upd.count > 0) await notifyBackupFailed(j.snapshotId).catch(() => undefined);
    }
    if (j.restoreId) {
      await prisma.restoreJob.updateMany({
        where: { id: j.restoreId, status: "running" },
        data: { status: "failed", error: "agent timed out", finishedAt: now },
      });
    }
  }

  return { offline: offline.count, stuck: stuckJobs.length };
}
