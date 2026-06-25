/**
 * Distinct Coolify servers per instance, derived from discovered resources:
 * `instanceId -> (serverUuid -> serverName)`. Used by the instances and agents
 * pages to render per-server blocks / dropdowns.
 */
export function groupServersByInstance(
  rows: Array<{ instanceId: string; serverUuid: string | null; serverName: string | null }>,
): Map<string, Map<string, string>> {
  const byInstance = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (!r.serverUuid) continue;
    const m = byInstance.get(r.instanceId) ?? new Map<string, string>();
    if (!m.has(r.serverUuid)) m.set(r.serverUuid, r.serverName ?? r.serverUuid);
    byInstance.set(r.instanceId, m);
  }
  return byInstance;
}
