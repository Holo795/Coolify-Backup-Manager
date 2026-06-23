import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, Button, statusTone, EmptyState } from "@/components/ui";
import { restoreSnapshot, retrySnapshot, cancelSnapshot, deleteSnapshot } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { ConfirmDeleteButton } from "@/components/confirm-delete";
import { formatBytes, timeAgo } from "@/lib/cn";
import { Archive, RotateCcw, RefreshCw, X } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SnapshotsPage() {
  const [snapshots, liveAgents] = await Promise.all([
    prisma.snapshot.findMany({
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { resource: true, destination: true, _count: { select: { artifacts: true } } },
    }),
    prisma.agent.findMany({
      where: { status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } },
      select: { instanceId: true },
    }),
  ]);
  const liveInstanceIds = new Set(liveAgents.map((a) => a.instanceId).filter(Boolean));

  return (
    <>
      <PageHeader title="Snapshots" description="Backup runs and one-click restores" />
      {snapshots.length === 0 ? (
        <EmptyState icon={<Archive className="h-6 w-6" />} title="No snapshots yet" hint="Run a backup from the Resources page." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
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
                      <div className="flex items-center justify-end gap-1.5">
                        {s.status === "succeeded" &&
                          (hasAgent ? (
                            <ActionButton
                              action={restoreSnapshot.bind(null, s.id, "in_place")}
                              variant="outline"
                              size="sm"
                              confirm="Restore this snapshot in place? This overwrites current data."
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Restore
                            </ActionButton>
                          ) : (
                            <Button variant="outline" size="sm" disabled title="No live agent for this resource's instance — restore needs one">
                              <RotateCcw className="h-3.5 w-3.5" /> Restore
                            </Button>
                          ))}
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
                              Permanently removes this <b>{s.resource.name}</b> snapshot ({formatBytes(s.sizeBytes)}),
                              including <b>its files on the destination</b> (deleted by the agent).
                            </>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
