import {
  AgentRegisterResponse,
  PollResponse,
  type JobEvent,
  type JobResult,
  type HeartbeatRequest,
} from "@cbm/shared";
import type { AgentConfig } from "./config.js";

async function req(cfg: AgentConfig, path: string, init: RequestInit, auth = true): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as any) };
  if (auth && cfg.agentToken) headers["authorization"] = `Bearer ${cfg.agentToken}`;
  return fetch(`${cfg.controllerUrl}${path}`, { ...init, headers });
}

export async function register(cfg: AgentConfig): Promise<AgentRegisterResponse> {
  const res = await req(
    cfg,
    "/api/agents/register",
    {
      method: "POST",
      body: JSON.stringify({
        enrollmentToken: cfg.enrollmentToken,
        hostname: cfg.hostname,
        instanceUuid: cfg.instanceUuid || undefined,
        agentVersion: "0.1.0",
      }),
    },
    false,
  );
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return AgentRegisterResponse.parse(await res.json());
}

export async function poll(cfg: AgentConfig): Promise<PollResponse> {
  const res = await req(cfg, "/api/agents/jobs", { method: "GET" });
  if (res.status === 204) return { job: null };
  if (!res.ok) throw new Error(`poll failed: ${res.status} ${await res.text()}`);
  return PollResponse.parse(await res.json());
}

export async function sendEvent(cfg: AgentConfig, event: JobEvent): Promise<void> {
  await req(cfg, `/api/agents/jobs/${encodeURIComponent(event.jobId)}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

export async function sendResult(cfg: AgentConfig, result: JobResult): Promise<void> {
  const res = await req(cfg, `/api/agents/jobs/${encodeURIComponent(result.jobId)}/result`, {
    method: "POST",
    body: JSON.stringify(result),
  });
  if (!res.ok) throw new Error(`result failed: ${res.status} ${await res.text()}`);
}

export async function heartbeat(cfg: AgentConfig, data: HeartbeatRequest): Promise<void> {
  await req(cfg, "/api/agents/heartbeat", { method: "POST", body: JSON.stringify(data) }).catch(
    () => undefined,
  );
}
