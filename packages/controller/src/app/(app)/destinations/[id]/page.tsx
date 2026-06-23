import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui";
import { formatBytes } from "@/lib/cn";
import { HardDrive, ArrowLeft, Lock } from "lucide-react";

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
