import { prisma } from "./prisma";
import { computeKeepSet } from "./gfs";
import { enqueuePrune } from "./jobs";

export { computeKeepSet } from "./gfs";

/**
 * Grandfather-father-son retention. Keeps the most recent N daily, plus a
 * number of distinct weekly and monthly snapshots; deletes the rest.
 *
 * Files are deleted on the destination via an agent "prune" job (the files live
 * on the agent host for `local`, and ssh/s3 are reachable from it), then the DB
 * record is removed.
 */
export async function applyRetention(policyId: string): Promise<{ deleted: number }> {
  const policy = await prisma.backupPolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.mode === "sync") return { deleted: 0 };

  const where = policy.resourceId
    ? { id: policy.resourceId }
    : policy.instanceId && policy.serverUuid
      ? { instanceId: policy.instanceId, serverUuid: policy.serverUuid, backupEnabled: true }
      : policy.instanceId
        ? { instanceId: policy.instanceId, backupEnabled: true }
        : { backupEnabled: true };
  const resources = await prisma.resource.findMany({ where, select: { id: true, instanceId: true } });

  let deleted = 0;
  for (const r of resources) {
    const snaps = await prisma.snapshot.findMany({
      where: { resourceId: r.id, policyId: policy.id, status: "succeeded" },
      orderBy: { startedAt: "desc" },
      include: { destination: true },
    });
    const keep = computeKeepSet(
      snaps.map((s) => ({ id: s.id, at: s.startedAt })),
      policy.retentionDaily,
      policy.retentionWeekly,
      policy.retentionMonthly,
    );
    const toDelete = snaps.filter((s) => !keep.has(s.id));
    if (toDelete.length === 0) continue;

    // Delete files on the destination via the agent. Group per destination, and
    // for a "local" destination also per producing agent (the files live on that
    // agent's host, so only it can delete them).
    const byGroup = new Map<
      string,
      {
        destination: (typeof toDelete)[number]["destination"];
        agentId: string | null;
        dirs: string[];
        resticSnapshotIds: string[];
        snapshotIds: string[];
      }
    >();
    for (const s of toDelete) {
      const agentId = s.destination.type === "local" ? s.agentId : null;
      const key = `${s.destinationId}::${agentId ?? ""}`;
      const g = byGroup.get(key) ?? { destination: s.destination, agentId, dirs: [], resticSnapshotIds: [], snapshotIds: [] };
      g.dirs.push(s.destinationDir);
      g.snapshotIds.push(s.id);
      if (s.resticSnapshotId) g.resticSnapshotIds.push(s.resticSnapshotId);
      byGroup.set(key, g);
    }
    for (const g of byGroup.values()) {
      // Only drop the DB rows once the agent has actually been handed the delete:
      // if no agent is available (enqueue returns null) or it throws, keep the
      // rows so the files aren't orphaned and retention retries next run.
      const queued = await enqueuePrune({
        instanceId: r.instanceId,
        destination: g.destination,
        dirs: g.dirs,
        resticSnapshotIds: g.resticSnapshotIds,
        agentId: g.agentId,
      }).catch((e) => {
        console.warn(`[retention] prune enqueue failed: ${(e as Error).message}`);
        return null;
      });
      if (!queued) continue;
      await prisma.snapshot.deleteMany({ where: { id: { in: g.snapshotIds } } });
      deleted += g.snapshotIds.length;
    }
  }
  return { deleted };
}
