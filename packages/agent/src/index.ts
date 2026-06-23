#!/usr/bin/env node
import { startDaemon } from "./daemon.js";
import { logger } from "./logger.js";

startDaemon().catch((e) => {
  logger.error(`Agent crashed: ${e?.message || e}`);
  process.exit(1);
});
