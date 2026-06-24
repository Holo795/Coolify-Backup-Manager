import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, Badge, statusTone } from "@/components/ui";
import { repinDeployment, deleteSnapshot } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { ConfirmDeleteButton } from "@/components/confirm-delete";
import { RestoreActions } from "@/components/restore-actions";
import { LiveLog } from "@/components/live-log";
import { formatBytes, formatDateTime } from "@/lib/cn";
import { getTimezone } from "@/lib/settings";
import { GitCommitHorizontal } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SnapshotDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await prisma.snapshot.findUnique({
    where: { id },
    include: { resource: true, destination: true, artifacts: true },
  });
  if (!snapshot) notFound();

  const restores = await prisma.restoreJob.findMany({
    where: { snapshotId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Restore (and re-pin) need a live agent to execute on the host.
  const liveAgent = await prisma.agent.findFirst({
    where: { instanceId: snapshot.resource.instanceId, status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } },
    select: { id: true },
  });
  const agentDown = !liveAgent;
  const tz = await getTimezone();

  const manifest = snapshot.manifest as { provenance?: { gitCommitSha?: string; imageDigest?: string } } | null;

  return (
    <>
      <PageHeader
        title={snapshot.resource.name}
        description={`${snapshot.mode} · ${snapshot.captureMode} · ${snapshot.destination.name}`}
        action={
          <div className="flex items-center gap-2">
            {snapshot.status === "succeeded" &&
              !agentDown &&
              manifest?.provenance?.gitCommitSha &&
              manifest.provenance.gitCommitSha !== "HEAD" && (
                <ActionButton
                  action={repinDeployment.bind(null, snapshot.id)}
                  variant="outline"
                  size="md"
                  confirm="Re-pin the deployment to this snapshot's commit and redeploy?"
                >
                  <GitCommitHorizontal className="h-4 w-4" /> Re-pin code
                </ActionButton>
              )}
            {snapshot.status === "succeeded" && <RestoreActions snapshotId={snapshot.id} hasAgent={!agentDown} size="md" />}
            <ConfirmDeleteButton
              action={deleteSnapshot.bind(null, snapshot.id)}
              confirmWord="DELETE"
              title="Delete this snapshot?"
              variant="outline"
              size="md"
              label="Delete"
              redirectTo="/snapshots"
              body={
                <>
                  Permanently removes this snapshot ({formatBytes(snapshot.sizeBytes)}), including{" "}
                  <b>its files on the destination</b> (deleted by the agent).
                </>
              }
            />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row k="Status" v={<Badge tone={statusTone(snapshot.status)}>{snapshot.status}</Badge>} />
            <Row k="Directory" v={<span className="font-mono text-xs">{snapshot.destinationDir}</span>} />
            <Row k="Size" v={formatBytes(snapshot.sizeBytes)} />
            <Row k="Commit" v={<span className="font-mono text-xs">{manifest?.provenance?.gitCommitSha ?? "—"}</span>} />
            <Row k="Image" v={<span className="font-mono text-xs">{manifest?.provenance?.imageDigest ?? "—"}</span>} />
            {snapshot.error && <Row k="Error" v={<span className="text-[var(--color-danger)]">{snapshot.error}</span>} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {snapshot.artifacts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 overflow-x-auto whitespace-nowrap">
                  <span className="font-mono text-xs">{a.filename}</span>
                </div>
                <span className="shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
                  {a.encrypted && <Badge tone="success">enc</Badge>}
                  {formatBytes(a.sizeBytes)}
                </span>
              </div>
            ))}
            {snapshot.artifacts.length === 0 && <span className="text-muted-foreground">No artifacts.</span>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Backup log</CardTitle>
        </CardHeader>
        <CardContent>
          <LiveLog id={snapshot.id} initialStatus={snapshot.status} timeZone={tz} />
        </CardContent>
      </Card>

      {restores.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Restores</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {restores.map((r) => (
              <div key={r.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  <span className="text-muted-foreground">
                    {r.target === "new_resource" ? "→ new resource" : "in place"} · {formatDateTime(r.createdAt, tz)}
                  </span>
                  {r.error && <span className="text-xs text-[var(--color-danger)]">{r.error}</span>}
                </div>
                <LiveLog id={r.id} kind="restore" initialStatus={r.status} timeZone={tz} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-1.5 last:border-0 min-w-0">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <div className="min-w-0 overflow-x-auto whitespace-nowrap text-right">
        {v}
      </div>
    </div>
  );
}
