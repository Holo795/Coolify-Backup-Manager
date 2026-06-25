import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { liveAgentWhere } from "@/lib/agent-status";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, Button, statusTone, EmptyState } from "@/components/ui";
import { retrySnapshot, cancelSnapshot, deleteSnapshot } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { ConfirmDeleteButton } from "@/components/confirm-delete";
import { RestoreActions } from "@/components/restore-actions";
import { formatBytes, timeAgo } from "@/lib/cn";
import { Archive, RefreshCw, X } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SnapshotsPage() {
  const [snapshots, liveAgents] = await Promise.all([
    prisma.snapshot.findMany({
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { resource: true, destination: true, _count: { select: { artifacts: true } } },
    }),
    prisma.agent.findMany({
      where: liveAgentWhere(),
      select: { instanceId: true },
    }),
  ]);
  const liveInstanceIds = new Set(liveAgents.map((a) => a.instanceId).filter(Boolean));

  // Row actions, reused by the desktop table and the mobile cards.
  const snapshotActions = (s: (typeof snapshots)[number], hasAgent: boolean) => (
    <>
      {s.status === "succeeded" && <RestoreActions snapshotId={s.id} hasAgent={hasAgent} />}
      {s.status === "failed" &&
        (hasAgent ? (
          <ActionButton action={retrySnapshot.bind(null, s.id)} variant="outline" size="sm" successMsg="Retried">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </ActionButton>
        ) : (
          <Button variant="outline" size="sm" disabled title="No live agent">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        ))}
      {s.status === "running" && (
        <ActionButton action={cancelSnapshot.bind(null, s.id)} variant="ghost" size="sm" successMsg="Cancelled">
          <X className="h-3.5 w-3.5" /> Cancel
        </ActionButton>
      )}
      <ConfirmDeleteButton
        action={deleteSnapshot.bind(null, s.id)}
        confirmWord="DELETE"
        title="Delete this snapshot?"
        body={
          <>
            Permanently removes this <b>{s.resource.name}</b> snapshot ({formatBytes(s.sizeBytes)}), including{" "}
            <b>its files on the destination</b> (deleted by the agent).
          </>
        }
      />
    </>
  );

  return (
    <>
      <PageHeader title="Snapshots" description="Backup runs and one-click restores" />
      {snapshots.length === 0 ? (
        <EmptyState icon={<Archive className="h-6 w-6" />} title="No snapshots yet" hint="Run a backup from the Resources page." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Resource</th>
                  <th className="px-4 py-2.5 font-medium">Mode</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Artifacts</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => {
                  const hasAgent = liveInstanceIds.has(s.resource.instanceId);
                  return (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/snapshots/${s.id}`} className="font-medium hover:underline">
                        {s.resource.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{s.destination.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {s.mode} · {s.captureMode}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s._count.artifacts}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatBytes(s.sizeBytes)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{timeAgo(s.startedAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">{snapshotActions(s, hasAgent)}</div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile: one card per snapshot. */}
            <div className="divide-y md:hidden">
              {snapshots.map((s) => {
                const hasAgent = liveInstanceIds.has(s.resource.instanceId);
                return (
                  <div key={s.id} className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/snapshots/${s.id}`} className="font-medium hover:underline">
                          {s.resource.name}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">{s.destination.name}</div>
                      </div>
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{s.mode} · {s.captureMode}</span>
                      <span>{s._count.artifacts} artifacts</span>
                      <span>{formatBytes(s.sizeBytes)}</span>
                      <span>{timeAgo(s.startedAt)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">{snapshotActions(s, hasAgent)}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
