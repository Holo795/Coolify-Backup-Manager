import type { VerifyDestinationJob } from "@cbm/shared";
import { MANIFEST_FILE } from "@cbm/shared";
import { makeTransfer } from "./transfer.js";
import { resticListSnapshotIds, withResticCtx } from "./restic.js";
import type { Emit } from "./backup.js";

/**
 * Reconcile a destination: check that each snapshot directory's files are still
 * present. A directory whose manifest is gone is reported as missing - the
 * controller then marks that snapshot and alerts. This catches backups deleted
 * directly at the destination (which otherwise only surface at restore time).
 */
export async function runVerifyDestination(
  job: VerifyDestinationJob,
  emit: Emit,
): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = [];
  const missing: string[] = [];

  if (job.storage.engine === "restic") {
    // Confirm each expected restic snapshot id still exists in the repo. Keys
    // are the restic snapshot ids (the controller maps them back to snapshots).
    const ids = job.resticSnapshotIds ?? [];
    if (ids.length === 0) return { present, missing };
    if (!job.storage.resticPassword) throw new Error("restic verify requires the repository password");
    emit("info", `Checking ${ids.length} restic snapshot(s)`, 20);
    const repo = await withResticCtx(job.destination, job.storage.resticPassword, (ctx) =>
      resticListSnapshotIds(ctx),
    );
    for (const id of ids) (repo.has(id) ? present : missing).push(id);
    emit("info", `Reconciliation done: ${present.length} present, ${missing.length} missing`, 100);
    return { present, missing };
  }

  if (job.dirs.length === 0) return { present, missing };

  const transfer = await makeTransfer(job.destination);
  try {
    let i = 0;
    for (const dir of job.dirs) {
      i++;
      emit("info", `Checking ${dir} (${i}/${job.dirs.length})`, Math.round((i / job.dirs.length) * 100));
      // A snapshot is "present" when its manifest is still listed under its dir.
      const files = await transfer.list(dir).catch(() => [] as string[]);
      const ok = files.some((f) => f === `${dir}/${MANIFEST_FILE}` || f.endsWith(`/${MANIFEST_FILE}`));
      if (ok) present.push(dir);
      else missing.push(dir);
    }
    emit(
      "info",
      `Reconciliation done: ${present.length} present, ${missing.length} missing`,
      100,
    );
    return { present, missing };
  } finally {
    await transfer.close().catch(() => undefined);
  }
}
