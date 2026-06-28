/** Database engine detection from a container image - used to give services'
 * internal databases (and Redis-family stores) a proper logical export instead
 * of a frozen volume copy. */

export type Engine = "postgresql" | "mysql" | "mariadb" | "mongodb" | "redis" | "keydb" | "dragonfly";

/** SQL/document engines we take a logical dump of (pg_dump/mysqldump/…). */
export const SQL_ENGINES: Engine[] = ["postgresql", "mysql", "mariadb", "mongodb"];
/** Redis-protocol stores we snapshot via an RDB export. */
export const REDIS_ENGINES: Engine[] = ["redis", "keydb", "dragonfly"];

// Most specific first so "mariadb" wins over "mysql" and "keydb"/"dragonfly"
// win over "redis".
const IMAGE_HINTS: [Engine, string[]][] = [
  ["mariadb", ["mariadb"]],
  ["mysql", ["mysql", "percona"]],
  ["postgresql", ["postgres", "pgvector", "timescale", "supabase/postgres"]],
  ["mongodb", ["mongo"]],
  ["keydb", ["keydb"]],
  ["dragonfly", ["dragonfly", "dfly"]],
  ["redis", ["redis", "valkey"]],
];

/** Best-effort engine for a container image (null if it isn't a known DB). */
export function detectEngine(image: string | undefined): Engine | null {
  if (!image) return null;
  const i = image.toLowerCase();
  for (const [engine, hints] of IMAGE_HINTS) {
    if (hints.some((h) => i.includes(h))) return engine;
  }
  return null;
}

export function isSqlEngine(e: Engine): boolean {
  return SQL_ENGINES.includes(e);
}

export function isRedisEngine(e: Engine): boolean {
  return REDIS_ENGINES.includes(e);
}
