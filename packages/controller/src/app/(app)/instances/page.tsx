import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { ScheduleForm } from "@/components/schedule-form";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Button, Badge, statusTone, EmptyState } from "@/components/ui";
import { connectInstance, syncInstanceAction, deleteInstance, deployAgentAction, regenerateEnrollToken, setInstanceSchedule, removeInstanceSchedule, backupCoolifyInstance } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { timeAgo } from "@/lib/cn";
import { describeCron, cronToFrequency } from "@/lib/schedule";
import { Server, RefreshCw, Trash2, Rocket, KeyRound, CalendarClock, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InstancesPage() {
  const [instances, destinations] = await Promise.all([
    prisma.coolifyInstance.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { resources: true, agents: true } },
        policies: { where: { resourceId: null }, include: { destination: true }, take: 1 },
      },
    }),
    prisma.destination.findMany({ orderBy: { name: "asc" } }),
  ]);

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
            instances.map((i) => (
              <Card key={i.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="font-medium">{i.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{i.baseUrl}</div>
                      <div className="text-xs text-muted-foreground">
                        {i._count.resources} resources · {i._count.agents} agents · synced {timeAgo(i.lastSyncedAt)}
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
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <span className="text-xs text-muted-foreground">Agent:</span>
                    <Badge tone={statusTone(i.agentDeployStatus === "deployed" ? "online" : i.agentDeployStatus)}>
                      {i._count.agents > 0 ? "connected" : i.agentDeployStatus}
                    </Badge>
                    <form action={deployAgentAction.bind(null, i.id)}>
                      <Button size="sm" variant="outline" type="submit">
                        <Rocket className="h-3.5 w-3.5" /> {i.agentResourceUuid ? "Redeploy" : "Deploy"} agent
                      </Button>
                    </form>
                    <form action={regenerateEnrollToken.bind(null, i.id)}>
                      <Button size="sm" variant="ghost" type="submit" title="Rotate the enrollment token">
                        <KeyRound className="h-3.5 w-3.5" /> Regenerate token
                      </Button>
                    </form>
                    <ActionButton action={backupCoolifyInstance.bind(null, i.id)} variant="outline" size="sm" successMsg="Queued">
                      <ShieldCheck className="h-3.5 w-3.5" /> Back up Coolify
                    </ActionButton>
                  </div>
                  <div className="border-t pt-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      {i.policies[0] ? (
                        <span>
                          Backups <span className="font-medium text-foreground">{describeCron(i.policies[0].cron)}</span> →{" "}
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
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Manual install (zero-config — the token identifies this instance)
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-md bg-muted/40 p-3 font-mono leading-relaxed">{`docker run -d --name cbm-agent --restart unless-stopped \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -e CONTROLLER_URL=${env.agentControllerUrl || env.authUrl} \\
  -e ENROLLMENT_TOKEN=${i.enrollToken} \\
  ${env.agentImage}:${env.agentImageTag}`}</pre>
                  </details>
                </CardContent>
              </Card>
            ))
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
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="autoDeploy" defaultChecked /> Auto-deploy the backup agent on this host
              </label>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
