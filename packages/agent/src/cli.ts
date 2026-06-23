/**
 * Standalone CLI for testing the backup/restore engine without a controller.
 *
 *   tsx src/cli.ts run <job.json>     # execute a backup or restore job
 *   tsx src/cli.ts keygen             # print a fresh AES-256 key (base64)
 */
import { readFile, writeFile } from "node:fs/promises";
import { Job } from "@cbm/shared";
import { setDockerBin } from "./docker.js";
import { executeJob } from "./runner.js";
import { generateKeyB64 } from "./crypto.js";

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  setDockerBin(process.env.DOCKER_BIN || "docker");

  if (cmd === "keygen") {
    process.stdout.write(generateKeyB64() + "\n");
    return;
  }

  if (cmd === "run") {
    if (!arg) throw new Error("usage: cli run <job.json>");
    const raw = JSON.parse(await readFile(arg, "utf8"));
    const job = Job.parse(raw);
    const workDir = process.env.AGENT_WORK_DIR || "/tmp/cbm-agent";
    const result = await executeJob(job, workDir, (e) => {
      const p = e.progress !== undefined ? ` (${Math.round(e.progress)}%)` : "";
      process.stderr.write(`  ${e.level.toUpperCase()}: ${e.message}${p}\n`);
    });
    if (result.manifest) {
      const out = `${arg}.manifest.json`;
      await writeFile(out, JSON.stringify(result.manifest, null, 2));
      process.stderr.write(`Manifest written to ${out}\n`);
    }
    process.stdout.write(JSON.stringify({ status: result.status, error: result.error }, null, 2) + "\n");
    if (result.status !== "succeeded") process.exit(1);
    return;
  }

  process.stderr.write("usage: cli <run|keygen> [args]\n");
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message || e}\n`);
  process.exit(1);
});
