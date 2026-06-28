import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, statusTone, EmptyState } from "@/components/ui";
import { deleteAgent } from "@/app/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete";
import { AgentServerSelect } from "@/components/agent-server-select";
import { groupServersByInstance } from "@/lib/servers";
import { timeAgo } from "@/lib/cn";
import { Cpu } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "asc" }, include: { instance: true } });

  // Candidate servers per instance, derived from discovered resources (no extra
  // Coolify API call). Drives the per-agent "Server" override dropdown.
  const serverRows = await prisma.resource.findMany({
    where: { serverUuid: { not: null } },
    select: { instanceId: true, serverUuid: true, serverName: true },
  });
  const serversByInstance = groupServersByInstance(serverRows);
  const serverOptionsFor = (instanceId: string | null) =>
    instanceId
      ? [...(serversByInstance.get(instanceId)?.entries() ?? [])].map(([uuid, name]) => ({ uuid, name }))
      : [];

  return (
    <>
      <PageHeader
        title="Agents"
        description="One per Docker host. Agents auto-enroll and self-link when you connect a Coolify instance."
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={<Cpu className="h-6 w-6" />}
          title="No agents connected"
          hint="Connect a Coolify instance, then run its one-line install command (Reveal install command) on the host - the agent enrolls and links itself."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Desktop: table. Mobile: cards (below). */}
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Host</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Instance</th>
                  <th className="px-4 py-2.5 font-medium">Server</th>
                  <th className="px-4 py-2.5 font-medium">Docker</th>
                  <th className="px-4 py-2.5 font-medium">Containers</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-medium">{a.hostname}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {a.instance ? (
                        <Link href="/instances" className="hover:underline">
                          {a.instance.name}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-warning)]">unlinked</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <AgentServerSelect
                        agentId={a.id}
                        serverUuid={a.serverUuid}
                        serverName={a.serverName}
                        serverManual={a.serverManual}
                        options={serverOptionsFor(a.instanceId)}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.dockerVersion ?? "-"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{a.containers ?? 0}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{timeAgo(a.lastSeenAt)}</td>
                    <td className="px-4 py-2.5">
                      <ConfirmDeleteButton
                        action={deleteAgent.bind(null, a.id)}
                        confirmWord={a.hostname}
                        title={`Remove agent “${a.hostname}”?`}
                        body={
                          <>
                            Removes this agent from the controller. If it&apos;s still running on{" "}
                            <b>{a.hostname}</b>, it will keep failing until you reconfigure it (re-run the install
                            command).
                          </>
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: one card per agent. */}
            <div className="divide-y md:hidden">
              {agents.map((a) => (
                <div key={a.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.hostname}</span>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Instance:{" "}
                      {a.instance ? (
                        <Link href="/instances" className="text-foreground hover:underline">
                          {a.instance.name}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-warning)]">unlinked</span>
                      )}
                    </span>
                    <span>Docker {a.dockerVersion ?? "-"}</span>
                    <span>{a.containers ?? 0} containers</span>
                    <span>seen {timeAgo(a.lastSeenAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <AgentServerSelect
                      agentId={a.id}
                      serverUuid={a.serverUuid}
                      serverName={a.serverName}
                      serverManual={a.serverManual}
                      options={serverOptionsFor(a.instanceId)}
                    />
                    <ConfirmDeleteButton
                      action={deleteAgent.bind(null, a.id)}
                      confirmWord={a.hostname}
                      title={`Remove agent “${a.hostname}”?`}
                      body={
                        <>
                          Removes this agent from the controller. If it&apos;s still running on <b>{a.hostname}</b>, it
                          will keep failing until you reconfigure it.
                        </>
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        Agents are deployed and configured from the{" "}
        <Link href="/instances" className="text-accent hover:underline">
          Coolify instances
        </Link>{" "}
        page - each instance has its own enrollment token, so agents link themselves automatically.
      </p>
    </>
  );
}
