import os from "node:os";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export interface AgentConfig {
  controllerUrl: string;
  enrollmentToken: string;
  agentToken: string;
  hostname: string;
  workDir: string;
  dockerBin: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}

export function loadConfig(): AgentConfig {
  return {
    controllerUrl: env("CONTROLLER_URL", "http://localhost:3000").replace(/\/$/, ""),
    enrollmentToken: optional("ENROLLMENT_TOKEN"),
    agentToken: optional("AGENT_TOKEN"),
    hostname: optional("AGENT_HOSTNAME", os.hostname()),
    workDir: optional("AGENT_WORK_DIR", "/tmp/cbm-agent"),
    dockerBin: optional("DOCKER_BIN", "docker"),
    pollIntervalMs: Number(optional("POLL_INTERVAL_MS", "5000")),
    heartbeatIntervalMs: Number(optional("HEARTBEAT_INTERVAL_MS", "30000")),
  };
}
