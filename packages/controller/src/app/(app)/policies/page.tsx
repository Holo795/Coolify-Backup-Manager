import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Button, Badge, EmptyState } from "@/components/ui";
import { createPolicy, deletePolicy } from "@/app/actions";
import { CalendarClock, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const [policies, destinations, resources] = await Promise.all([
    prisma.backupPolicy.findMany({ orderBy: { createdAt: "asc" }, include: { destination: true, resource: true } }),
    prisma.destination.findMany({ orderBy: { name: "asc" } }),
    prisma.resource.findMany({ where: { backupEnabled: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Policies" description="Scheduled backups with GFS retention" />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          {policies.length === 0 ? (
            <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No policies" hint="Schedule recurring backups for your resources." />
          ) : (
            policies.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {p.name}
                      <Badge tone="accent">{p.mode}</Badge>
                      <Badge>{p.enabled ? "enabled" : "disabled"}</Badge>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {p.cron} → {p.destination.name} · {p.resource ? p.resource.name : "all enabled resources"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      retention: {p.retentionDaily}d / {p.retentionWeekly}w / {p.retentionMonthly}m
                    </div>
                  </div>
                  <form action={deletePolicy.bind(null, p.id)}>
                    <Button size="sm" variant="danger" type="submit" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New policy</CardTitle>
          </CardHeader>
          <CardContent>
            {destinations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add a destination first.</p>
            ) : (
              <ActionForm action={createPolicy} submitLabel="Create policy">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" placeholder="Nightly" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cron">Cron</Label>
                  <Input id="cron" name="cron" defaultValue="0 2 * * *" className="font-mono" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="mode">Mode</Label>
                    <Select id="mode" name="mode">
                      <option value="backup">backup (versioned)</option>
                      <option value="sync">sync (single copy)</option>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="destinationId">Destination</Label>
                    <Select id="destinationId" name="destinationId" required>
                      {destinations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="resourceId">Scope</Label>
                  <Select id="resourceId" name="resourceId">
                    <option value="">All backup-enabled resources</option>
                    {resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.type})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field name="retentionDaily" label="Daily" def="7" />
                  <Field name="retentionWeekly" label="Weekly" def="4" />
                  <Field name="retentionMonthly" label="Monthly" def="6" />
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({ name, label, def }: { name: string; label: string; def: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" defaultValue={def} min={0} />
    </div>
  );
}
