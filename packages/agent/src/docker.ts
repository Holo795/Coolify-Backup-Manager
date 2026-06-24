import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";

let DOCKER = "docker";
export function setDockerBin(bin: string) {
  DOCKER = bin;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a docker command, buffering stdout/stderr as strings. */
export function docker(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Run a docker command and stream stdout into a file (for dumps). */
export async function dockerToFile(args: string[], outFile: string): Promise<void> {
  const out = createWriteStream(outFile);
  const child = spawn(DOCKER, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  // Capture the exit code independently, then await the write completing.
  // (Using `once(out,"close")` after the child exits races: for tiny outputs
  // the stream closes first and we'd await an event that already fired.)
  const exit = once(child, "close") as Promise<[number]>;
  await pipeline(child.stdout, out);
  const [code] = await exit;
  if (code !== 0) {
    throw new Error(`docker ${args.join(" ")} exited ${code}: ${stderr.slice(0, 2000)}`);
  }
}

/** Run a docker command feeding a file into stdin (for restores). */
export async function dockerFromFile(args: string[], inFile: string): Promise<void> {
  const child = spawn(DOCKER, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  child.stdout.on("data", (d) => (stdout += d.toString()));
  const input = createReadStream(inFile);
  input.pipe(child.stdin);
  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) {
    throw new Error(`docker ${args.join(" ")} exited ${code}: ${stderr.slice(0, 2000)}`);
  }
}

export async function inspectContainer(name: string): Promise<any | null> {
  const r = await docker(["inspect", name]);
  if (r.code !== 0) return null;
  try {
    const arr = JSON.parse(r.stdout);
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

export async function inspectImage(image: string): Promise<any | null> {
  const r = await docker(["image", "inspect", image]);
  if (r.code !== 0) return null;
  try {
    const arr = JSON.parse(r.stdout);
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

export async function containerExists(name: string): Promise<boolean> {
  const r = await docker(["inspect", "-f", "{{.Id}}", name]);
  return r.code === 0;
}

export async function stopContainer(name: string): Promise<void> {
  const r = await docker(["stop", name]);
  if (r.code !== 0) throw new Error(`docker stop ${name} failed: ${r.stderr}`);
}

export async function startContainer(name: string): Promise<void> {
  const r = await docker(["start", name]);
  if (r.code !== 0) throw new Error(`docker start ${name} failed: ${r.stderr}`);
}

/** Freeze a container's processes in place (no restart, state preserved). */
export async function pauseContainer(name: string): Promise<void> {
  const r = await docker(["pause", name]);
  if (r.code !== 0) throw new Error(`docker pause ${name} failed: ${r.stderr}`);
}

/** Resume a previously frozen container. */
export async function unpauseContainer(name: string): Promise<void> {
  const r = await docker(["unpause", name]);
  if (r.code !== 0) throw new Error(`docker unpause ${name} failed: ${r.stderr}`);
}

/**
 * Running containers that mount `volume` read-write — i.e. the ones that could
 * be writing to it, so they need a brief freeze for a consistent copy. A volume
 * mounted read-only (or by no running container) needs no freeze.
 */
export async function runningRwContainersForVolume(volume: string): Promise<string[]> {
  const r = await docker(["ps", "--filter", `volume=${volume}`, "--format", "{{.Names}}"]);
  if (r.code !== 0) return [];
  const names = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const name of names) {
    const info = await inspectContainer(name);
    const mounts: Array<{ Name?: string; Source?: string; RW?: boolean }> = info?.Mounts ?? [];
    const m = mounts.find((x) => x?.Name === volume || x?.Source?.endsWith(`/volumes/${volume}/_data`));
    // RW === false means read-only; anything else is treated as writable.
    if (!m || m.RW !== false) out.push(name);
  }
  return out;
}

/** Tar a docker volume into a tarball on the host using a throwaway helper. */
export async function tarVolume(volume: string, outFile: string): Promise<void> {
  // Stream the tar of the volume contents to stdout, then into outFile.
  await dockerToFile(
    [
      "run",
      "--rm",
      "-v",
      `${volume}:/data:ro`,
      "alpine:3.20",
      "tar",
      "-cf",
      "-",
      "-C",
      "/data",
      ".",
    ],
    outFile,
  );
}

/** Restore a tarball into a docker volume (creates it if missing). */
export async function restoreVolume(volume: string, inFile: string): Promise<void> {
  await docker(["volume", "create", volume]);
  await dockerFromFile(
    [
      "run",
      "--rm",
      "-i",
      "-v",
      `${volume}:/data`,
      "alpine:3.20",
      "sh",
      "-c",
      "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar -xf - -C /data",
    ],
    inFile,
  );
}

export async function dockerVersion(): Promise<string> {
  const r = await docker(["version", "--format", "{{.Server.Version}}"]);
  return r.code === 0 ? r.stdout.trim() : "unknown";
}

export async function countContainers(): Promise<number> {
  const r = await docker(["ps", "-q"]);
  if (r.code !== 0) return 0;
  return r.stdout.split("\n").filter((l) => l.trim().length > 0).length;
}
