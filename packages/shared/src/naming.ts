/** Helpers for deterministic snapshot directory / file naming. */

/** Build the relative directory for a snapshot. */
export function snapshotDir(
  resourceUuid: string,
  mode: "backup" | "sync",
  isoTimestamp: string,
): string {
  if (mode === "sync") {
    // Single overwritten copy — no timestamp.
    return `${resourceUuid}/sync`;
  }
  const safe = isoTimestamp.replace(/[:.]/g, "-");
  return `${resourceUuid}/backups/${safe}`;
}

/** Stable artifact file name for a database dump. */
export function dumpFileName(engine: string, database: string | undefined): string {
  const db = database && database.length > 0 ? database : "all";
  return `dump-${engine}-${db}.sql`;
}

/** Stable artifact file name for a docker volume tarball. */
export function volumeFileName(volume: string): string {
  return `volume-${volume}.tar`;
}

export const CONFIG_FILE = "config.json";
export const ENV_FILE = "env.json";
export const MANIFEST_FILE = "manifest.json";
export const ENCRYPTED_SUFFIX = ".age";
