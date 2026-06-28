/** Minimal 5-field cron matcher: "min hour dom month dow" (dow 0-6, Sun=0). */

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const stepSplit = part.split("/");
    const range = stepSplit[0];
    const step = stepSplit[1] ? parseInt(stepSplit[1], 10) : 1;
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const m = range.split("-");
      lo = parseInt(m[0], 10);
      hi = m[1] !== undefined ? parseInt(m[1], 10) : lo;
    }
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

// Constructing an Intl.DateTimeFormat is relatively expensive; the missed-backup
// scan calls partsInZone tens of thousands of times, so cache one per timezone.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      minute: "2-digit",
      hour: "2-digit",
      day: "2-digit",
      month: "2-digit",
      weekday: "short",
    });
    fmtCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Wall-clock parts of `date` as seen in the given IANA timezone. */
function partsInZone(date: Date, timeZone: string): {
  minute: number;
  hour: number;
  day: number;
  month: number;
  dow: number;
} {
  const fmt = zoneFormatter(timeZone);
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const dows: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // hour can be "24" at midnight in some locales; normalise to 0.
  const hour = parseInt(p.hour, 10) % 24;
  return {
    minute: parseInt(p.minute, 10),
    hour,
    day: parseInt(p.day, 10),
    month: parseInt(p.month, 10),
    dow: dows[p.weekday] ?? 0,
  };
}

/**
 * Match a 5-field cron against `date`, evaluated in `timeZone` (IANA, e.g.
 * "Europe/Paris"). Defaults to UTC when no zone is given.
 */
export function cronMatches(expr: string, date: Date, timeZone = "UTC"): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron expression: "${expr}"`);
  const [min, hour, dom, mon, dow] = fields;
  const minutes = parseField(min, 0, 59);
  const hours = parseField(hour, 0, 23);
  const doms = parseField(dom, 1, 31);
  const mons = parseField(mon, 1, 12);
  const dows = parseField(dow, 0, 6);

  const now = partsInZone(date, timeZone);
  const matchDom = dom !== "*";
  const matchDow = dow !== "*";
  const domOk = doms.has(now.day);
  const dowOk = dows.has(now.dow);

  return (
    minutes.has(now.minute) &&
    hours.has(now.hour) &&
    mons.has(now.month) &&
    // Standard cron: if both dom and dow are restricted, match either.
    (matchDom && matchDow ? domOk || dowOk : domOk && dowOk)
  );
}

export function isValidCron(expr: string): boolean {
  try {
    cronMatches(expr, new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Most recent time `expr` should have fired at or before `now` (evaluated in
 * `timeZone`), scanning back minute-by-minute up to `maxDays`. Returns null if
 * the schedule hasn't fired within that window. Used to detect missed backups.
 *
 * Note: on a spring-forward DST day a wall-clock minute that the cron targets
 * (e.g. 02:30 when the clock jumps 02:00→03:00) doesn't exist, so the scan finds
 * the previous valid fire instead - the missed-backup alert may be a day late
 * for that one schedule on that one day. Acceptable for an alerting heuristic.
 */
export function previousFireWithin(expr: string, now: Date, timeZone = "UTC", maxDays = 40): Date | null {
  if (!isValidCron(expr)) return null;
  const start = new Date(now.getTime());
  start.setSeconds(0, 0);
  const steps = maxDays * 24 * 60;
  for (let i = 0; i < steps; i++) {
    const t = new Date(start.getTime() - i * 60_000);
    if (cronMatches(expr, t, timeZone)) return t;
  }
  return null;
}
