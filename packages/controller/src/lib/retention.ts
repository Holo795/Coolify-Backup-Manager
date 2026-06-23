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
    : policy.instanceId
      ? { instanceId: policy.instanceId, excluded: false }
      : { backupEnabled: true, excluded: false };
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

    // Delete files on the destination via the agent, grouped per destination.
    const byDest = new Map<string, { destination: (typeof toDelete)[number]["destination"]; dirs: string[] }>();
    for (const s of toDelete) {
      const g = byDest.get(s.destinationId) ?? { destination: s.destination, dirs: [] };
      g.dirs.push(s.destinationDir);
      byDest.set(s.destinationId, g);
    }
    for (const g of byDest.values()) {
      await enqueuePrune({ instanceId: r.instanceId, destination: g.destination, dirs: g.dirs }).catch((e) =>
        console.warn(`[retention] prune enqueue failed: ${(e as Error).message}`),
      );
    }

    for (const s of toDelete) {
      await prisma.snapshot.delete({ where: { id: s.id } });
      deleted++;
    }
  }
  return { deleted };
}
