import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { computeKeepSet } from "./gfs";
import type { ResolvedDestination } from "@cbm/shared";

export { computeKeepSet } from "./gfs";

/**
 * Grandfather-father-son retention. Keeps the most recent N daily, plus a
 * number of distinct weekly and monthly snapshots; deletes the rest.
 *
 * Physical deletion is performed for `local` destinations (controller shares
 * the filesystem in single-host deployments). For `ssh`/`s3` the DB record is
 * removed and a warning logged — a dedicated agent "prune" job is the planned
 * follow-up (see report).
 */
export async function applyRetention(policyId: string): Promise<{ deleted: number }> {
  const policy = await prisma.backupPolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.mode === "sync") return { deleted: 0 };

  const resources = policy.resourceId
    ? [{ id: policy.resourceId }]
    : policy.instanceId
      ? await prisma.resource.findMany({ where: { instanceId: policy.instanceId, excluded: false }, select: { id: true } })
      : await prisma.resource.findMany({ where: { backupEnabled: true, excluded: false }, select: { id: true } });

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
    for (const s of snaps) {
      if (keep.has(s.id)) continue;
      await prunePhysical(JSON.parse(decryptSecret(s.destination.configEnc)), s.destinationDir).catch(
        (e) => console.warn(`[retention] physical prune failed: ${(e as Error).message}`),
      );
      await prisma.snapshot.delete({ where: { id: s.id } });
      deleted++;
    }
  }
  return { deleted };
}

async function prunePhysical(dest: ResolvedDestination, dir: string): Promise<void> {
  if (dest.type === "local") {
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await rm(join(dest.basePath, dir), { recursive: true, force: true });
  } else {
    console.warn(`[retention] remote destination (${dest.type}) prune deferred for ${dir}`);
  }
}
