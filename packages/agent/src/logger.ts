type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const min = (process.env.LOG_LEVEL as Level) || "info";

function log(level: Level, msg: string, extra?: unknown) {
  if (order[level] < order[min]) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra !== undefined) {
    console[level === "debug" ? "log" : level](line, extra);
  } else {
    console[level === "debug" ? "log" : level](line);
  }
}

export const logger = {
  debug: (m: string, e?: unknown) => log("debug", m, e),
  info: (m: string, e?: unknown) => log("info", m, e),
  warn: (m: string, e?: unknown) => log("warn", m, e),
  error: (m: string, e?: unknown) => log("error", m, e),
};
