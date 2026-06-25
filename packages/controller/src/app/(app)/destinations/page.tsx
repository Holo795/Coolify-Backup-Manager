import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { DestinationForm } from "@/components/destination-form";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui";
import { testDestinationAction, deleteDestination, verifyDestinationNow } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { ConfirmDeleteButton } from "@/components/confirm-delete";
import { formatBytes } from "@/lib/cn";
import { HardDrive, Lock, PlugZap, ChevronRight, ShieldCheck, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DestinationsPage() {
  const [destinations, sizeGroups, missingGroups] = await Promise.all([
    prisma.destination.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { snapshots: true, policies: true } } },
    }),
    prisma.snapshot.groupBy({ by: ["destinationId"], _sum: { sizeBytes: true }, where: { status: "succeeded" } }),
    prisma.snapshot.groupBy({ by: ["destinationId"], _count: { _all: true }, where: { status: "missing" } }),
  ]);

  const sizeByDest = new Map(sizeGroups.map((g) => [g.destinationId, g._sum.sizeBytes ?? 0n]));
  const missingByDest = new Map(missingGroups.map((g) => [g.destinationId, g._count._all]));
  const globalBytes = Array.from(sizeByDest.values()).reduce((a, b) => a + BigInt(b), 0n);

  return (
    <>
      <PageHeader
        title="Destinations"
        description={`Where backups are stored — local, SSH/SFTP, or S3 · ${formatBytes(globalBytes)} stored across all destinations`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          {destinations.length === 0 ? (
            <EmptyState icon={<HardDrive className="h-6 w-6" />} title="No destinations" hint="Add a place to store your backups." />
          ) : (
            destinations.map((d) => {
              const bytes = sizeByDest.get(d.id) ?? 0n;
              const missing = missingByDest.get(d.id) ?? 0;
              return (
                <Card key={d.id}>
                  <CardContent className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <Link href={`/destinations/${d.id}`} className="hover:underline">
                          {d.name}
                        </Link>
                        <Badge tone="accent">{d.type}</Badge>
                        {d.engine === "restic" && <Badge tone="accent">restic</Badge>}
                        {(d.encryptionEnabled || d.engine === "restic") && (
                          <Badge tone="success">
                            <Lock className="h-3 w-3" /> encrypted
                          </Badge>
                        )}
                        {missing > 0 && (
                          <Badge tone="danger">
                            <AlertTriangle className="h-3 w-3" /> {missing} missing
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{formatBytes(bytes)}</span> · {d._count.snapshots}{" "}
                        snapshots · {d._count.policies} schedule{d._count.policies === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ActionButton
                        action={verifyDestinationNow.bind(null, d.id)}
                        variant="outline"
                        size="sm"
                        successMsg="Checking…"
                        disabled={d._count.snapshots === 0}
                        title={d._count.snapshots === 0 ? "No backups to verify yet" : "Check that every backup is still present"}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Verify
                      </ActionButton>
                      <ActionButton action={testDestinationAction.bind(null, d.id)} variant="outline" size="sm" successMsg="Reachable ✓">
                        <PlugZap className="h-3.5 w-3.5" /> Test
                      </ActionButton>
                      <ConfirmDeleteButton
                        action={deleteDestination.bind(null, d.id)}
                        confirmWord={d.name}
                        title={`Delete destination “${d.name}”?`}
                        body={
                          <>
                            This permanently removes the destination{" "}
                            <b>
                              and all {d._count.snapshots} backup{d._count.snapshots === 1 ? "" : "s"}
                            </b>{" "}
                            recorded against it ({formatBytes(bytes)}).{" "}
                            <span className="text-foreground">This cannot be undone.</span>
                          </>
                        }
                      />
                      <Link
                        href={`/destinations/${d.id}`}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Open destination"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add a destination</CardTitle>
          </CardHeader>
          <CardContent>
            <DestinationForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
