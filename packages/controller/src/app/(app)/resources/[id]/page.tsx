import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { ScheduleForm } from "@/components/schedule-form";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent, CardHeader, CardTitle, Badge, statusTone } from "@/components/ui";
import { setResourceOptions, setResourceSchedule, removeResourceOverride, backupNow, deleteSnapshot } from "@/app/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete";
import { RestoreActions } from "@/components/restore-actions";
import { effectivePolicy, describeCron, cronToFrequency } from "@/lib/schedule";
import { getTimezone } from "@/lib/settings";
import { formatBytes, timeAgo } from "@/lib/cn";
import { Play, ArrowLeft, Unplug } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ResourceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resource = await prisma.resource.findUnique({ where: { id }, include: { instance: true } });
  if (!resource) notFound();

  const [destinations, override, snapshots, eff] = await Promise.all([
    prisma.destination.findMany({ orderBy: { name: "asc" } }),
    prisma.backupPolicy.findFirst({ where: { resourceId: id }, include: { destination: true } }),
    prisma.snapshot.findMany({
      where: { resourceId: id },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { destination: true },
    }),
    effectivePolicy(id),
  ]);

  // Backups/restores need a live agent on this resource's instance.
  const liveAgent = await prisma.agent.findFirst({
    where: { instanceId: resource.instanceId, status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } },
    select: { id: true },
  });
  const agentDown = !liveAgent;
  const removed = resource.status === "deleted"; // no longer in Coolify
  const tz = await getTimezone();

  return (
    <>
      <Link href="/resources" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Resources
      </Link>
      <PageHeader
        title={resource.name}
        description={`${resource.type} · ${resource.instance.name}${resource.projectName ? " · " + resource.projectName : ""}`}
        action={
          agentDown || removed ? undefined : (
            <ActionButton action={backupNow.bind(null, resource.id)} variant="primary" size="md" successMsg="Backup queued">
              <Play className="h-4 w-4" /> Back up now
            </ActionButton>
          )
        }
      />

      {removed && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          This resource no longer exists in Coolify. You can&apos;t back it up, but its snapshots below can still be
          restored (use “→ new” to recreate it).
        </div>
      )}

      <div className="relative">
        <div
          className={agentDown ? "pointer-events-none select-none blur-[3px]" : ""}
          aria-hidden={agentDown || undefined}
        >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Backup options</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={setResourceOptions.bind(null, resource.id)} submitLabel="Save options" resetOnSuccess={false}>
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Les sauvegardes ne redémarrent jamais cette ressource. Les bases de données sont exportées en marche ;
                pour les fichiers, l&apos;agent fige (met en pause) quelques secondes uniquement les conteneurs qui
                écrivent, puis les relance — sans aucun redémarrage.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="liveBackup" defaultChecked={resource.liveBackup} className="mt-0.5" />
                <span>
                  <span className="font-medium">Copier en marche, sans figer (à mes risques)</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Copie les fichiers sans aucun gel : zéro interruption, mais un fichier réécrit pile pendant la copie
                    pourrait être incohérent. À éviter si la ressource écrit beaucoup hors base de données.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="excluded" defaultChecked={resource.excluded} /> Exclude from scheduled backups
              </label>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <p className="text-sm text-muted-foreground">
              {override ? (
                <>Custom override for this resource.</>
              ) : eff.source === "instance" ? (
                <>
                  Inherits <span className="text-foreground">{resource.instance.name}</span>:{" "}
                  {eff.policy ? describeCron(eff.policy.cron, tz) : "—"} → {eff.policy?.destination.name}
                </>
              ) : eff.source === "none" ? (
                <span className="text-[var(--color-warning)]">No schedule — set one on the instance, or override here.</span>
              ) : (
                <>Covered by a global schedule.</>
              )}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {override && (
              <div className="flex items-center gap-2 text-xs">
                <Badge tone="accent">override</Badge>
                <span>
                  {describeCron(override.cron, tz)} → {override.destination.name} · {override.mode}
                </span>
                <form action={removeResourceOverride.bind(null, resource.id)}>
                  <button type="submit" className="text-[var(--color-danger)] hover:underline">
                    revert to inherited
                  </button>
                </form>
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {override ? "Edit override" : "Override schedule for this resource"}
              </summary>
              <div className="mt-3">
                <ScheduleForm
                  action={setResourceSchedule.bind(null, resource.id)}
                  destinations={destinations}
                  submitLabel={override ? "Update override" : "Create override"}
                  defaults={
                    override
                      ? {
                          frequency: cronToFrequency(override.cron),
                          customCron: override.cron,
                          destinationId: override.destinationId,
                          mode: override.mode,
                          retentionDaily: override.retentionDaily,
                          retentionWeekly: override.retentionWeekly,
                          retentionMonthly: override.retentionMonthly,
                        }
                      : undefined
                  }
                />
              </div>
            </details>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium text-muted-foreground">Snapshots</h2>
      {snapshots.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No snapshots yet for this resource.
        </p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Mode</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">Destination</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/snapshots/${s.id}`} className="hover:underline">
                        {timeAgo(s.startedAt)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {s.mode} · {s.captureMode}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatBytes(s.sizeBytes)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{s.destination.name}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {s.status === "succeeded" && <RestoreActions snapshotId={s.id} hasAgent={!agentDown} />}
                        <ConfirmDeleteButton
                          action={deleteSnapshot.bind(null, s.id)}
                          confirmWord="DELETE"
                          title="Delete this snapshot?"
                          body={
                            <>
                              Permanently removes this snapshot ({formatBytes(s.sizeBytes)}), including{" "}
                              <b>its files on the destination</b> (deleted by the agent).
                            </>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
        </div>
        {agentDown && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border bg-card/80 px-6 py-5 text-center shadow-lg backdrop-blur-sm">
              <Unplug className="h-6 w-6 text-[var(--color-warning)]" />
              <div className="font-medium">Agent unavailable</div>
              <p className="text-sm text-muted-foreground">
                Cette ressource n&apos;est pas disponible : aucun agent n&apos;est installé sur{" "}
                <span className="text-foreground">{resource.instance.name}</span>.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
