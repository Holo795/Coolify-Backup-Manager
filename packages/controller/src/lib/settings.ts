import { prisma } from "./prisma";

const DEFAULT_TZ = "Europe/Paris";

// Tiny cache so the per-minute scheduler doesn't hit the DB every tick.
let cache: { tz: string; at: number } | null = null;
const TTL_MS = 30_000;

/** Read the configured IANA timezone (cached briefly). */
export async function getTimezone(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.tz;
  const row = await prisma.setting.findUnique({ where: { id: "global" } }).catch(() => null);
  const tz = row?.timezone || DEFAULT_TZ;
  cache = { tz, at: Date.now() };
  return tz;
}

/** Validate an IANA timezone string (e.g. "Europe/Paris"). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Persist the timezone (upserts the single settings row). */
export async function setTimezone(tz: string): Promise<void> {
  await prisma.setting.upsert({
    where: { id: "global" },
    create: { id: "global", timezone: tz },
    update: { timezone: tz },
  });
  cache = { tz, at: Date.now() };
}

export { DEFAULT_TZ };
