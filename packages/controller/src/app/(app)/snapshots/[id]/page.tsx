import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, statusTone } from "@/components/ui";
import { restoreSnapshot, repinDeployment } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { LiveLog } from "@/components/live-log";
import { formatBytes } from "@/lib/cn";
import { RotateCcw, GitCommitHorizontal } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SnapshotDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await prisma.snapshot.findUnique({
    where: { id },
    include: { resource: true, destination: true, artifacts: true },
  });
  if (!snapshot) notFound();

  const manifest = snapshot.manifest as { provenance?: { gitCommitSha?: string; imageDigest?: string } } | null;

  return (
    <>
      <PageHeader
        title={snapshot.resource.name}
        description={`${snapshot.mode} · ${snapshot.captureMode} · ${snapshot.destination.name}`}
        action={
          snapshot.status === "succeeded" ? (
            <div className="flex items-center gap-2">
              {manifest?.provenance?.gitCommitSha && manifest.provenance.gitCommitSha !== "HEAD" && (
                <ActionButton
                  action={repinDeployment.bind(null, snapshot.id)}
                  variant="outline"
                  size="md"
                  confirm="Re-pin the deployment to this snapshot's commit and redeploy?"
                >
                  <GitCommitHorizontal className="h-4 w-4" /> Re-pin code
                </ActionButton>
              )}
              <ActionButton
                action={restoreSnapshot.bind(null, snapshot.id, "in_place")}
                variant="primary"
                size="md"
                confirm="Restore this snapshot in place? This overwrites current data."
              >
                <RotateCcw className="h-4 w-4" /> Restore in place
              </ActionButton>
            </div>
          ) : null
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
              <div key={a.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{a.filename}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
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
          <CardTitle>Log</CardTitle>
        </CardHeader>
        <CardContent>
          <LiveLog snapshotId={snapshot.id} initialStatus={snapshot.status} />
        </CardContent>
      </Card>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
