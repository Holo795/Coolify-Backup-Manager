import { prisma } from "./prisma";
import type { BackupPolicy, Destination } from "@/generated/prisma/client";

/** Frequency presets -> cron (evaluated in the timezone set in Settings). */
export const FREQUENCIES: Record<string, string> = {
  hourly: "0 * * * *",
  daily: "0 2 * * *",
  weekly: "0 2 * * 1",
  monthly: "0 2 1 * *",
};

export function freqToCron(freq: string, customCron?: string): string {
  if (freq === "custom") return (customCron || "0 2 * * *").trim();
  return FREQUENCIES[freq] ?? FREQUENCIES.daily;
}

/** Map a cron back to a frequency preset for prefilling forms. */
export function cronToFrequency(cron: string): string {
  for (const [name, expr] of Object.entries(FREQUENCIES)) {
    if (expr === cron) return name;
  }
  return "custom";
}

/** Human description of a cron expression for the UI. */
export function describeCron(cron: string, timeZone?: string): string {
  const z = timeZone ? ` ${timeZone}` : "";
  for (const [name, expr] of Object.entries(FREQUENCIES)) {
    if (expr === cron) {
      if (name === "weekly") return `weekly (Mon 02:00${z})`;
      if (name === "monthly") return `monthly (1st, 02:00${z})`;
      if (name === "daily") return `daily at 02:00${z}`;
      if (name === "hourly") return "hourly";
    }
  }
  return cron;
}

export type PolicyWithDest = BackupPolicy & { destination: Destination };

/**
 * Resolve the schedule that governs a resource:
 *  - its own override policy, else
 *  - its instance's policy, else
 *  - any global policy (instanceId & resourceId both null).
 */
export async function effectivePolicy(resourceId: string): Promise<{
  policy: PolicyWithDest | null;
  source: "resource" | "instance" | "global" | "none";
}> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource) return { policy: null, source: "none" };

  const own = await prisma.backupPolicy.findFirst({
    where: { resourceId, enabled: true },
    include: { destination: true },
  });
  if (own) return { policy: own, source: "resource" };

  const instancePolicy = await prisma.backupPolicy.findFirst({
    where: { instanceId: resource.instanceId, enabled: true },
    include: { destination: true },
  });
  if (instancePolicy) return { policy: instancePolicy, source: "instance" };

  const global = await prisma.backupPolicy.findFirst({
    where: { instanceId: null, resourceId: null, enabled: true },
    include: { destination: true },
  });
  if (global) return { policy: global, source: "global" };

  return { policy: null, source: "none" };
}
