import type { PruneJob } from "@cbm/shared";
import { makeTransfer } from "./transfer.js";
import type { Emit } from "./backup.js";

/** Delete backup directories from a destination (local / SSH / S3). */
export async function runPrune(job: PruneJob, emit: Emit): Promise<void> {
  if (job.dirs.length === 0) return;
  const transfer = await makeTransfer(job.destination);
  try {
    let i = 0;
    for (const dir of job.dirs) {
      i++;
      emit("info", `Deleting ${dir}`, Math.round((i / job.dirs.length) * 100));
      await transfer.removeDir(dir);
    }
    emit("info", `Deleted ${job.dirs.length} backup director${job.dirs.length === 1 ? "y" : "ies"}`);
  } finally {
    await transfer.close().catch(() => undefined);
  }
}
