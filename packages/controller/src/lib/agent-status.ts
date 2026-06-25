/**
 * Single source of truth for "is an agent currently online". An agent is online
 * if it reported `online` and its last heartbeat is within AGENT_ONLINE_MS. The
 * reaper, the page queries and the in-memory checks all use these so the window
 * can't drift between them.
 */
export const AGENT_ONLINE_MS = 90_000;

/** Prisma `where` selecting agents currently online (optionally one instance). */
export function liveAgentWhere(instanceId?: string) {
  return {
    status: "online",
    lastSeenAt: { gte: new Date(Date.now() - AGENT_ONLINE_MS) },
    ...(instanceId ? { instanceId } : {}),
  };
}

/** True if an agent row (status + lastSeenAt) is currently online. */
export function isAgentOnline(a: { status: string; lastSeenAt: Date | null }): boolean {
  return a.status === "online" && !!a.lastSeenAt && Date.now() - new Date(a.lastSeenAt).getTime() < AGENT_ONLINE_MS;
}
