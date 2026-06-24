import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { ScheduleForm } from "@/components/schedule-form";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Button, Badge, statusTone, EmptyState } from "@/components/ui";
import { connectInstance, syncInstanceAction, deleteInstance, setInstanceSchedule, removeInstanceSchedule, backupCoolifyInstance } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { RevealInstall } from "@/components/reveal-install";
import { timeAgo } from "@/lib/cn";
import { describeCron, cronToFrequency } from "@/lib/schedule";
import { getTimezone } from "@/lib/settings";
import { Server, RefreshCw, Trash2, CalendarClock, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InstancesPage() {
  const [instances, destinations] = await Promise.all([
    prisma.coolifyInstance.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { resources: true } },
        agents: { select: { status: true, lastSeenAt: true } },
        policies: { where: { resourceId: null }, include: { destination: true }, take: 1 },
      },
    }),
    prisma.destination.findMany({ orderBy: { name: "asc" } }),
  ]);
  const tz = await getTimezone();

  // Last scheduled run per instance schedule: the most recent runId + its tally.
  const policyIds = instances.map((i) => i.policies[0]?.id).filter((x): x is string => !!x);
  const latestRuns = policyIds.length
    ? await prisma.snapshot.findMany({
        where: { policyId: { in: policyIds }, runId: { not: null } },
        orderBy: { startedAt: "desc" },
        distinct: ["policyId"],
        select: { policyId: true, runId: true, startedAt: true },
      })
    : [];
  const runByPolicy = new Map<string, { at: Date; ok: number; failed: number; running: number; total: number }>();
  await Promise.all(
    latestRuns.map(async (run) => {
      if (!run.runId || !run.policyId) return;
      const groups = await prisma.snapshot.groupBy({ by: ["status"], where: { runId: run.runId }, _count: true });
      let ok = 0;
      let failed = 0;
      let running = 0;
      let total = 0;
      for (const g of groups) {
        total += g._count;
        if (g.status === "succeeded") ok = g._count;
        else if (g.status === "failed") failed = g._count;
        else if (g.status === "running") running = g._count;
      }
      runByPolicy.set(run.policyId, { at: run.startedAt, ok, failed, running, total });
    }),
  );

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
              // "Connected" must mean a live agent (recent heartbeat), not just a
              // lingering Agent row left behind by a removed/old agent.
              const liveAgents = i.agents.filter(
                (a) => a.status === "online" && a.lastSeenAt && Date.now() - new Date(a.lastSeenAt).getTime() < 90_000,
              ).length;
              const staleAgents = i.agents.length - liveAgents;
              const lastRun = i.policies[0] ? runByPolicy.get(i.policies[0].id) : undefined;
              return (
              <Card key={i.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="font-medium">{i.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{i.baseUrl}</div>
                      <div className="text-xs text-muted-foreground">
                        {i._count.resources} resources · {liveAgents} agent{liveAgents === 1 ? "" : "s"} online · synced{" "}
                        {timeAgo(i.lastSyncedAt)}
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
                  <div className="flex flex-col gap-3 border-t pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Agent:</span>
                      <Badge tone={statusTone(liveAgents > 0 ? "online" : staleAgents > 0 ? "offline" : "pending")}>
                        {liveAgents > 0 ? "connected" : staleAgents > 0 ? "agent offline" : "not installed"}
                      </Badge>
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
                  </div>
                  <div className="border-t pt-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      {i.policies[0] ? (
                        <span>
                          Backups <span className="font-medium text-foreground">{describeCron(i.policies[0].cron, tz)}</span> →{" "}
                          {i.policies[0].destination.name} · {i.policies[0].mode} · keep {i.policies[0].retentionDaily}d/
                          {i.policies[0].retentionWeekly}w/{i.policies[0].retentionMonthly}m
                        </span>
                      ) : (
                        <span className="text-[var(--color-warning)]">No backup schedule — nothing runs automatically.</span>
                      )}
                      {i.policies[0] && (
                        <form action={removeInstanceSchedule.bind(null, i.id)}>
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
                        {i.policies[0] ? "Edit schedule" : "Set a backup schedule for this instance"}
                      </summary>
                      <div className="mt-3">
                        <ScheduleForm
                          action={setInstanceSchedule.bind(null, i.id)}
                          destinations={destinations}
                          submitLabel={i.policies[0] ? "Update schedule" : "Set schedule"}
                          defaults={
                            i.policies[0]
                              ? {
                                  frequency: cronToFrequency(i.policies[0].cron),
                                  customCron: i.policies[0].cron,
                                  destinationId: i.policies[0].destinationId,
                                  mode: i.policies[0].mode,
                                  retentionDaily: i.policies[0].retentionDaily,
                                  retentionWeekly: i.policies[0].retentionWeekly,
                                  retentionMonthly: i.policies[0].retentionMonthly,
                                }
                              : undefined
                          }
                        />
                      </div>
                    </details>
                  </div>
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
                <Input id="name" name="name" placeholder="michelle" required />
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
