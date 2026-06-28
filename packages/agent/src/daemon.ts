import { loadConfig, type AgentConfig } from "./config.js";
import { setDockerBin, dockerVersion, countContainers, detectCoolifyResourceUuids } from "./docker.js";
import { logger } from "./logger.js";
import * as client from "./client.js";
import { runJobForController } from "./runner.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startDaemon(): Promise<void> {
  const cfg = loadConfig();
  setDockerBin(cfg.dockerBin);

  logger.info(`Agent starting (host=${cfg.hostname}, controller=${cfg.controllerUrl})`);

  // Register if we don't have a token yet.
  if (!cfg.agentToken) {
    if (!cfg.enrollmentToken) {
      throw new Error("No AGENT_TOKEN and no ENROLLMENT_TOKEN - cannot register");
    }
    try {
      const res = await withRetry("register", () => client.register(cfg));
      cfg.agentToken = res.agentToken;
      logger.info(`Registered as agent ${res.agentId}`);
    } catch (e) {
      if (/\b401\b/.test((e as Error).message)) {
        logger.error(
          "Enrollment token was rejected (invalid or rotated). Reveal a NEW install command in the " +
            "controller UI and re-run it on this host to reconfigure the agent.",
        );
        process.exit(1);
      }
      throw e;
    }
  }

  // Background heartbeat.
  void heartbeatLoop(cfg);

  logger.info(`Polling for jobs (concurrency=${cfg.concurrency})`);

  // Main loop: keep up to `concurrency` jobs running at once. Each finished job
  // posts its result independently, so a slow backup doesn't block the others.
  const inFlight = new Set<Promise<void>>();
  const startJob = (job: Awaited<ReturnType<typeof client.poll>>["job"]) => {
    if (!job) return;
    logger.info(`Picked up job ${job.id} (${job.type})`);
    const p = (async () => {
      const result = await runJobForController(job, cfg);
      await client.sendResult(cfg, result).catch((e) => logger.error(`send result failed`, e));
      logger.info(`Job ${job.id} finished: ${result.status}`);
    })()
      .catch((e) => logger.error(`job ${job.id} crashed: ${(e as Error).message}`))
      .finally(() => inFlight.delete(p));
    inFlight.add(p);
  };

  for (;;) {
    // Fill free slots until the queue is empty or we're at capacity.
    while (inFlight.size < cfg.concurrency) {
      let job = null;
      try {
        ({ job } = await client.poll(cfg));
      } catch (e) {
        logger.warn(`poll error: ${(e as Error).message}`);
        break;
      }
      if (!job) break;
      startJob(job);
    }
    // After the fill loop the queue is empty or we're full. Either way, wait for
    // a job to finish (frees a slot) or a poll tick before polling again - never
    // spin. With nothing running, just sleep the poll interval.
    if (inFlight.size === 0) {
      await sleep(cfg.pollIntervalMs);
    } else {
      await Promise.race([Promise.race([...inFlight]), sleep(cfg.pollIntervalMs)]);
    }
  }
}

async function heartbeatLoop(cfg: AgentConfig): Promise<void> {
  for (;;) {
    try {
      await client.heartbeat(cfg, {
        dockerVersion: await dockerVersion(),
        containers: await countContainers(),
        resourceUuids: await detectCoolifyResourceUuids().catch(() => []),
      });
    } catch {
      /* ignore */
    }
    await sleep(cfg.heartbeatIntervalMs);
  }
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 30): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Auth failures aren't transient - don't burn retries on a bad token.
      if (/\b401\b/.test((e as Error).message)) throw e;
      logger.warn(`${label} attempt ${i + 1} failed: ${(e as Error).message}`);
      await sleep(2000);
    }
  }
  throw lastErr;
}
