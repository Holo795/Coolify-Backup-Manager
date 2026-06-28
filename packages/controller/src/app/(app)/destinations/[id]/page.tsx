import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui";
import { formatBytes } from "@/lib/cn";
import { HardDrive, ArrowLeft, Lock, AlertTriangle, Server } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DestinationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dest = await prisma.destination.findUnique({ where: { id } });
  if (!dest) notFound();

  const groups = await prisma.snapshot.groupBy({
    by: ["resourceId"],
    _sum: { sizeBytes: true },
    _count: true,
    where: { destinationId: id, status: "succeeded" },
  });

  // For a "local" destination the files are physically split across each
  // producing agent's host - break the storage down by server so the size
  // isn't a misleading single number.
  const serverGroups = await prisma.snapshot.groupBy({
    by: ["agentId"],
    _sum: { sizeBytes: true },
    _count: true,
    where: { destinationId: id, status: "succeeded" },
  });
  const agentIds = serverGroups.map((g) => g.agentId).filter((x): x is string => !!x);
  const agentRows = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, hostname: true, serverName: true },
  });
  const agentById = new Map(agentRows.map((a) => [a.id, a]));
  const serverRows = serverGroups
    .map((g) => {
      const a = g.agentId ? agentById.get(g.agentId) : undefined;
      return {
        key: g.agentId ?? "unknown",
        label: a?.serverName ?? a?.hostname ?? "Unknown host",
        bytes: Number(g._sum.sizeBytes ?? 0n),
        count: g._count,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
  const showByServer = dest.type === "local" && serverRows.length > 1;

  const missingCount = await prisma.snapshot.count({ where: { destinationId: id, status: "missing" } });
  const resources = await prisma.resource.findMany({
    where: { id: { in: groups.map((g) => g.resourceId) } },
    select: { id: true, name: true, type: true },
  });
  const byId = new Map(resources.map((r) => [r.id, r]));

  const rows = groups
    .map((g) => ({
      id: g.resourceId,
      bytes: Number(g._sum.sizeBytes ?? 0n),
      count: g._count,
      name: byId.get(g.resourceId)?.name ?? "(deleted resource)",
      type: byId.get(g.resourceId)?.type,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const total = rows.reduce((acc, r) => acc + r.bytes, 0);
  const max = rows[0]?.bytes || 1;

  return (
    <>
      <Link href="/destinations" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Destinations
      </Link>
      <PageHeader
        title={dest.name}
        description={`${dest.type} · ${formatBytes(total)} across ${rows.length} resource${rows.length === 1 ? "" : "s"}`}
        action={
          dest.encryptionEnabled ? (
            <Badge tone="success">
              <Lock className="h-3 w-3" /> encrypted
            </Badge>
          ) : undefined
        }
      />

      {missingCount > 0 && (
        <Card className="mb-4 border-[var(--color-danger)]/40">
          <CardContent className="flex items-center gap-2 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" />
            <span>
              <b>{missingCount}</b> backup{missingCount === 1 ? "" : "s"} can no longer be found at this destination
              (files deleted at rest). They are flagged <Badge tone="danger">missing</Badge> in the snapshots list.
            </span>
          </CardContent>
        </Card>
      )}

      {showByServer && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Storage by server</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              This local destination is realised per agent - each server holds its own files at the configured path.
            </p>
            <div className="flex flex-col gap-2">
              {serverRows.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{s.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.count} snapshot{s.count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatBytes(s.bytes)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Storage by resource</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState icon={<HardDrive className="h-6 w-6" />} title="No backups here yet" hint="Run a backup to this destination to see its breakdown." />
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((r) => {
                const pct = total > 0 ? Math.round((r.bytes / total) * 100) : 0;
                const width = Math.max(2, (r.bytes / max) * 100);
                return (
                  <div key={r.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        {r.type && <Badge>{r.type}</Badge>}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.count} snapshot{r.count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatBytes(r.bytes)} <span className="text-xs text-muted-foreground">· {pct}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
