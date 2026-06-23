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

export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron expression: "${expr}"`);
  const [min, hour, dom, mon, dow] = fields;
  const minutes = parseField(min, 0, 59);
  const hours = parseField(hour, 0, 23);
  const doms = parseField(dom, 1, 31);
  const mons = parseField(mon, 1, 12);
  const dows = parseField(dow, 0, 6);

  // Use UTC to match server_timezone defaults.
  const matchDom = dom !== "*";
  const matchDow = dow !== "*";
  const domOk = doms.has(date.getUTCDate());
  const dowOk = dows.has(date.getUTCDay());

  return (
    minutes.has(date.getUTCMinutes()) &&
    hours.has(date.getUTCHours()) &&
    mons.has(date.getUTCMonth() + 1) &&
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
