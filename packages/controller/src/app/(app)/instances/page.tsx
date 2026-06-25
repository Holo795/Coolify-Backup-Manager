import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { ScheduleForm } from "@/components/schedule-form";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Button, Badge, statusTone, EmptyState } from "@/components/ui";
import {
  connectInstance,
  syncInstanceAction,
  deleteInstance,
  setInstanceSchedule,
  removeInstanceSchedule,
  setServerSchedule,
  removeServerSchedule,
  backupCoolifyInstance,
} from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { RevealInstall } from "@/components/reveal-install";
import { timeAgo } from "@/lib/cn";
import { describeCron, cronToFrequency } from "@/lib/schedule";
import { getTimezone } from "@/lib/settings";
import { isAgentOnline as agentOnline } from "@/lib/agent-status";
import { groupServersByInstance } from "@/lib/servers";
import { Server, RefreshCw, Trash2, CalendarClock, ShieldCheck } from "lucide-react";
import type { BackupPolicy, Destination } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

type PolicyWithDest = BackupPolicy & { destination: Destination };

export default async function InstancesPage() {
  const [instances, destinations, serverRows] = await Promise.all([
    prisma.coolifyInstance.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { resources: true } },
        agents: { select: { status: true, lastSeenAt: true, serverUuid: true } },
        policies: { where: { resourceId: null }, include: { destination: true } },
      },
    }),
    prisma.destination.findMany({ orderBy: { name: "asc" } }),
    prisma.resource.findMany({
      where: { serverUuid: { not: null } },
      select: { instanceId: true, serverUuid: true, serverName: true },
    }),
  ]);
  const tz = await getTimezone();

  // Distinct servers per instance (from discovered resources).
  const serversByInstance = groupServersByInstance(serverRows);

  // Last scheduled run per policy (instance- and server-level).
  const policyIds = instances.flatMap((i) => i.policies.map((p) => p.id));
  const latestRuns = policyIds.length
    ? await prisma.snapshot.findMany({
        where: { policyId: { in: policyIds }, runId: { not: null } },
        orderBy: { startedAt: "desc" },
        distinct: ["policyId"],
        select: { policyId: true, runId: true, startedAt: true },
      })
    : [];
  // Tally each run's snapshot statuses in ONE grouped query (not one per policy).
  const runIds = latestRuns.map((r) => r.runId).filter((x): x is string => !!x);
  const statusByRun = new Map<string, { ok: number; failed: number; running: number; total: number }>();
  if (runIds.length) {
    const groups = await prisma.snapshot.groupBy({ by: ["runId", "status"], where: { runId: { in: runIds } }, _count: true });
    for (const g of groups) {
      if (!g.runId) continue;
      const e = statusByRun.get(g.runId) ?? { ok: 0, failed: 0, running: 0, total: 0 };
      e.total += g._count;
      if (g.status === "succeeded") e.ok += g._count;
      else if (g.status === "failed") e.failed += g._count;
      else if (g.status === "running") e.running += g._count;
      statusByRun.set(g.runId, e);
    }
  }
  const runByPolicy = new Map<string, { at: Date; ok: number; failed: number; running: number; total: number }>();
  for (const run of latestRuns) {
    if (!run.runId || !run.policyId) continue;
    runByPolicy.set(run.policyId, { at: run.startedAt, ...(statusByRun.get(run.runId) ?? { ok: 0, failed: 0, running: 0, total: 0 }) });
  }

  // A schedule block (used both instance-wide and per-server).
  function scheduleBlock(opts: {
    policy: PolicyWithDest | undefined;
    lastRun: ReturnType<typeof runByPolicy.get>;
    action: (fd: FormData) => Promise<void | { ok?: boolean; error?: string; detail?: string }>;
    remove?: () => Promise<void>;
    emptyLabel: string;
  }) {
    const { policy, lastRun, action, remove, emptyLabel } = opts;
    return (
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
          {policy ? (
            <span>
              Backups <span className="font-medium text-foreground">{describeCron(policy.cron, tz)}</span> →{" "}
              {policy.destination.name} · {policy.mode} · keep {policy.retentionDaily}d/{policy.retentionWeekly}w/
              {policy.retentionMonthly}m
            </span>
          ) : (
            <span className="text-[var(--color-warning)]">No backup schedule — nothing runs automatically.</span>
          )}
          {policy && remove && (
            <form action={remove}>
              <button type="submit" className="text-[var(--color-danger)] hover:underline">
                remove
              </button>
            </form>
          )}
        </div>
        {lastRun && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Last run {timeAgo(lastRun.at)}:</span>
            <span className="text-[var(--color-success)]">✓ {lastRun.ok}</span>
            {lastRun.failed > 0 && <span className="text-[var(--color-danger)]">✗ {lastRun.failed}</span>}
            {lastRun.running > 0 && <span className="text-[var(--color-accent)]">⏳ {lastRun.running} running</span>}
            <span>
              · {lastRun.total} resource{lastRun.total === 1 ? "" : "s"}
            </span>
          </div>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {policy ? "Edit schedule" : emptyLabel}
          </summary>
          <div className="mt-3">
            <ScheduleForm
              action={action}
              destinations={destinations}
              submitLabel={policy ? "Update schedule" : "Set schedule"}
              defaults={
                policy
                  ? {
                      frequency: cronToFrequency(policy.cron),
                      customCron: policy.cron,
                      destinationId: policy.destinationId,
                      mode: policy.mode,
                      retentionDaily: policy.retentionDaily,
                      retentionWeekly: policy.retentionWeekly,
                      retentionMonthly: policy.retentionMonthly,
                    }
                  : undefined
              }
            />
          </div>
        </details>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Coolify instances" description="Connect each Coolify control plane via its API token" />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          {instances.length === 0 ? (
            <EmptyState
              icon={<Server className="h-6 w-6" />}
              title="No instances connected"
              hint="Add your first Coolify instance with its base URL and an API token."
            />
          ) : (
            instances.map((i) => {
              const liveAgents = i.agents.filter(agentOnline).length;
              const staleAgents = i.agents.length - liveAgents;
              const servers = [...(serversByInstance.get(i.id)?.entries() ?? [])].map(([uuid, name]) => ({ uuid, name }));
              const multiServer = servers.length > 1;
              const instancePolicy = i.policies.find((p) => !p.serverUuid);
              return (
                <Card key={i.id}>
                  <CardContent className="flex flex-col gap-4 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="font-medium">{i.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{i.baseUrl}</div>
                        <div className="text-xs text-muted-foreground">
                          {i._count.resources} resources ·{" "}
                          {servers.length > 0 ? `${servers.length} server${servers.length === 1 ? "" : "s"} · ` : ""}
                          {liveAgents} agent{liveAgents === 1 ? "" : "s"} online · synced {timeAgo(i.lastSyncedAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <form action={syncInstanceAction.bind(null, i.id)}>
                          <Button size="sm" variant="outline" type="submit">
                            <RefreshCw className="h-3.5 w-3.5" /> Sync
                          </Button>
                        </form>
                        <form action={deleteInstance.bind(null, i.id)}>
                          <Button size="sm" variant="danger" type="submit" aria-label="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </form>
                      </div>
                    </div>

                    {/* Instance-level: control-plane backup + shared install command. */}
                    <div className="flex flex-col gap-3 border-t pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {!multiServer && (
                          <>
                            <span className="text-xs text-muted-foreground">Agent:</span>
                            <Badge tone={statusTone(liveAgents > 0 ? "online" : staleAgents > 0 ? "offline" : "pending")}>
                              {liveAgents > 0 ? "connected" : staleAgents > 0 ? "agent offline" : "not installed"}
                            </Badge>
                          </>
                        )}
                        {i.enrollTokenHash && (
                          <span className="font-mono text-xs text-muted-foreground" title="Current enrollment token (masked)">
                            {i.enrollTokenHint}
                          </span>
                        )}
                        {liveAgents > 0 ? (
                          <ActionButton action={backupCoolifyInstance.bind(null, i.id)} variant="outline" size="sm" successMsg="Queued">
                            <ShieldCheck className="h-3.5 w-3.5" /> Back up Coolify
                          </ActionButton>
                        ) : (
                          <Button variant="outline" size="sm" disabled title="No live agent — install the agent below first">
                            <ShieldCheck className="h-3.5 w-3.5" /> Back up Coolify
                          </Button>
                        )}
                      </div>
                      <RevealInstall instanceId={i.id} hasToken={!!i.enrollTokenHash} />
                      {multiServer && (
                        <p className="text-xs text-muted-foreground">
                          This instance spans several servers — install the agent (same command) on each host below.
                        </p>
                      )}
                    </div>

                    {multiServer ? (
                      // One block per server: agent status + its own schedule.
                      <div className="flex flex-col gap-3 border-t pt-3">
                        {servers.map((sv) => {
                          const serverAgents = i.agents.filter((a) => a.serverUuid === sv.uuid);
                          const serverLive = serverAgents.filter(agentOnline).length;
                          const serverStale = serverAgents.length - serverLive;
                          const policy = i.policies.find((p) => p.serverUuid === sv.uuid);
                          return (
                            <div key={sv.uuid} className="rounded-lg border p-3">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-sm font-medium">{sv.name}</span>
                                <Badge tone={statusTone(serverLive > 0 ? "online" : serverStale > 0 ? "offline" : "pending")}>
                                  {serverLive > 0 ? "agent connected" : serverStale > 0 ? "agent offline" : "no agent installed"}
                                </Badge>
                                {serverLive === 0 && (
                                  <span className="text-xs text-[var(--color-warning)]">run the install command on this host</span>
                                )}
                              </div>
                              {scheduleBlock({
                                policy,
                                lastRun: policy ? runByPolicy.get(policy.id) : undefined,
                                action: setServerSchedule.bind(null, i.id, sv.uuid),
                                remove: removeServerSchedule.bind(null, i.id, sv.uuid),
                                emptyLabel: "Set a backup schedule for this server",
                              })}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // Single server (or none discovered yet): instance-wide schedule.
                      <div className="border-t pt-3">
                        {scheduleBlock({
                          policy: instancePolicy,
                          lastRun: instancePolicy ? runByPolicy.get(instancePolicy.id) : undefined,
                          action: setInstanceSchedule.bind(null, i.id),
                          remove: removeInstanceSchedule.bind(null, i.id),
                          emptyLabel: "Set a backup schedule for this instance",
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Connect an instance</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={connectInstance} submitLabel="Connect & sync">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="production" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input id="baseUrl" name="baseUrl" placeholder="https://coolify.example.com" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apiToken">API token</Label>
                <Input id="apiToken" name="apiToken" type="password" placeholder="cf_…" required />
              </div>
              <p className="text-xs text-muted-foreground">
                After connecting, reveal the install command on the instance card and run it on the Coolify host to
                start the agent.
              </p>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
