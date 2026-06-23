import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { DestinationForm } from "@/components/destination-form";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, EmptyState } from "@/components/ui";
import { deleteDestination, testDestinationAction } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { HardDrive, Trash2, Lock, PlugZap } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DestinationsPage() {
  const destinations = await prisma.destination.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { snapshots: true, policies: true } } },
  });

  return (
    <>
      <PageHeader title="Destinations" description="Where backups are stored — local, SSH/SFTP, or S3" />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          {destinations.length === 0 ? (
            <EmptyState icon={<HardDrive className="h-6 w-6" />} title="No destinations" hint="Add a place to store your backups." />
          ) : (
            destinations.map((d) => (
              <Card key={d.id}>
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {d.name}
                      <Badge tone="accent">{d.type}</Badge>
                      {d.encryptionEnabled && (
                        <Badge tone="success">
                          <Lock className="h-3 w-3" /> encrypted
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d._count.snapshots} snapshots · {d._count.policies} policies
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ActionButton action={testDestinationAction.bind(null, d.id)} variant="outline" size="sm" successMsg="Reachable ✓">
                      <PlugZap className="h-3.5 w-3.5" /> Test
                    </ActionButton>
                    <form action={deleteDestination.bind(null, d.id)}>
                      <Button size="sm" variant="danger" type="submit" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            ))
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
