import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a process and buffer stdout/stderr as strings. A non-zero exit is NOT an
 * error here - the caller inspects `code` (many callers expect a failing exit,
 * e.g. `docker inspect` on a missing container). Rejects only if the process
 * fails to spawn.
 */
export function runCapture(
  bin: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d) => (stdout += d.toString()));
    child.stderr!.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
