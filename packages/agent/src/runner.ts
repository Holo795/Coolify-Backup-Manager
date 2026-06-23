import type { Job, JobResult, JobEvent } from "@cbm/shared";
import type { AgentConfig } from "./config.js";
import { runBackup, type Emit } from "./backup.js";
import { runRestore } from "./restore.js";
import { runPrune } from "./prune.js";
import { logger } from "./logger.js";
import { sendEvent } from "./client.js";

/**
 * Execute a job, streaming events. `onEvent` receives every event (used to
 * forward to the controller). Returns the final JobResult.
 */
export async function executeJob(
  job: Job,
  workDir: string,
  onEvent?: (e: JobEvent) => void,
): Promise<JobResult> {
  const emit: Emit = (level, message, progress) => {
    const e: JobEvent = { jobId: job.id, ts: new Date().toISOString(), level, message, progress };
    logger[level](`[${job.id}] ${message}`);
    onEvent?.(e);
  };

  try {
    if (job.type === "backup") {
      const manifest = await runBackup(job, workDir, emit);
      return { jobId: job.id, status: "succeeded", manifest };
    } else if (job.type === "restore") {
      await runRestore(job, workDir, emit);
      return { jobId: job.id, status: "succeeded" };
    } else {
      await runPrune(job, emit);
      return { jobId: job.id, status: "succeeded" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit("error", `Job failed: ${message}`);
    return { jobId: job.id, status: "failed", error: message };
  }
}

/** Run a job and forward events + result to the controller. */
export async function runJobForController(job: Job, cfg: AgentConfig): Promise<JobResult> {
  return executeJob(job, cfg.workDir, (e) => void sendEvent(cfg, e));
}
