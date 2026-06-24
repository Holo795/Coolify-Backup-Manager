import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { cronMatches } from "./cron";
import { enqueueBackup } from "./jobs";
import { applyRetention } from "./retention";
import { reaper } from "./reaper";

const globalForSched = globalThis as unknown as { cbmSchedulerStarted?: boolean };

/** Evaluate all enabled policies and enqueue backups for those due now. */
export async function tick(now = new Date()): Promise<number> {
  const policies = await prisma.backupPolicy.findMany({ where: { enabled: true } });
  let triggered = 0;
  for (const p of policies) {
    let due = false;
    try {
      due = cronMatches(p.cron, now);
    } catch {
      continue;
    }
    if (!due) continue;

    let resources;
    if (p.resourceId) {
      // Resource override.
      resources = await prisma.resource.findMany({ where: { id: p.resourceId, excluded: false } });
    } else if (p.instanceId) {
      // Whole instance: all non-excluded resources WITHOUT their own override policy.
      const overrides = await prisma.backupPolicy.findMany({
        where: { resourceId: { not: null }, resource: { instanceId: p.instanceId }, enabled: true },
        select: { resourceId: true },
      });
      const skip = new Set(overrides.map((o) => o.resourceId));
      const all = await prisma.resource.findMany({ where: { instanceId: p.instanceId, excluded: false } });
      resources = all.filter((r) => !skip.has(r.id));
    } else {
      // Global fallback.
      resources = await prisma.resource.findMany({ where: { backupEnabled: true, excluded: false } });
    }

    const runId = randomUUID();
    for (const r of resources) {
      try {
        await enqueueBackup(r.id, p.id, runId);
        triggered++;
      } catch (e) {
        console.error(`[scheduler] enqueue failed for ${r.name}:`, (e as Error).message);
      }
    }
    // Retention runs after each policy fire (cheap, idempotent).
    await applyRetention(p.id).catch(() => undefined);
  }
  return triggered;
}

/** Start the minute-aligned scheduler loop (idempotent). */
export function startScheduler(): void {
  if (globalForSched.cbmSchedulerStarted) return;
  globalForSched.cbmSchedulerStarted = true;

  const schedule = () => {
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(async () => {
      try {
        await tick(new Date());
      } catch (e) {
        console.error("[scheduler] tick error", e);
      }
      try {
        await reaper(new Date());
      } catch (e) {
        console.error("[scheduler] reaper error", e);
      }
      schedule();
    }, msToNextMinute);
  };
  schedule();
  console.log("[scheduler] started");
}
