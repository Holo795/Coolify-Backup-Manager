"use client";

import { useState, useTransition } from "react";
import { updateAgentServer } from "@/app/actions";
import { Badge } from "@/components/ui";

type ServerOption = { uuid: string; name: string };

/**
 * Inline control to pin an agent to a Coolify server (manual), or leave it on
 * automatic detection. Only meaningful when an instance spans several servers.
 */
export function AgentServerSelect({
  agentId,
  serverUuid,
  serverName,
  serverManual,
  options,
}: {
  agentId: string;
  serverUuid: string | null;
  serverName: string | null;
  serverManual: boolean;
  options: ServerOption[];
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(serverUuid ?? "");

  // Nothing to choose between: just show what was detected (or a dash).
  if (options.length <= 1 && !serverManual) {
    return (
      <span className="text-muted-foreground">
        {serverName ?? (serverUuid ? serverUuid.slice(0, 8) : "-")}
        {serverName || serverUuid ? <Badge tone="neutral" className="ml-2">auto</Badge> : null}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <select
        className="rounded-md border bg-transparent px-2 py-1 text-sm"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          start(() => void updateAgentServer(agentId, v || null));
        }}
      >
        <option value="">Auto-detect</option>
        {options.map((o) => (
          <option key={o.uuid} value={o.uuid}>
            {o.name}
          </option>
        ))}
      </select>
      <Badge tone={serverManual ? "accent" : "neutral"}>{serverManual ? "manual" : "auto"}</Badge>
    </span>
  );
}
