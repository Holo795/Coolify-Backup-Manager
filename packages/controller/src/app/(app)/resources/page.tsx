import { prisma } from "@/lib/prisma";
import { liveAgentWhere } from "@/lib/agent-status";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, Button, Input, statusTone, EmptyState } from "@/components/ui";
import { backupNow } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { ResourceToggles } from "@/components/resource-toggles";
import { Boxes, Play, Unplug, Pin } from "lucide-react";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  const { q, type, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam || "1"));
  const where = {
    status: { not: "deleted" },
    // Control-plane (coolify-self) resources are pinned at the top separately.
    NOT: { coolifyUuid: { startsWith: "coolify-self" } },
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(type ? { type } : {}),
  };
  const [total, controlPlanes, resources, orphaned] = await Promise.all([
    prisma.resource.count({ where }),
    // Control planes: always shown, pinned at the top of every page.
    prisma.resource.findMany({
      where: { status: { not: "deleted" }, coolifyUuid: { startsWith: "coolify-self" } },
      orderBy: [{ name: "asc" }],
      include: { instance: true },
    }),
    prisma.resource.findMany({
      where,
      orderBy: [{ projectName: "asc" }, { name: "asc" }],
      include: { instance: true },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    // Resources removed from Coolify but kept for their backups.
    prisma.resource.findMany({
      where: { status: "deleted" },
      orderBy: [{ projectName: "asc" }, { name: "asc" }],
      include: { instance: true, _count: { select: { snapshots: true } } },
    }),
  ]);
  // Which instances have a live agent (recent heartbeat)? Resources whose
  // instance has none can't be backed up, so we grey them out + disable backup.
  const liveAgents = await prisma.agent.findMany({
    where: liveAgentWhere(),
    select: { instanceId: true },
  });
  const liveInstanceIds = new Set(liveAgents.map((a) => a.instanceId).filter(Boolean));

  // Control planes first (pinned), then this page's resources.
  const rows = [...controlPlanes, ...resources];

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const qs = (p: number) =>
    `/resources?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), page: String(p) }).toString()}`;

  return (
    <>
      <PageHeader title="Resources" description="Enable backups and pick a capture mode per resource" />

      <form className="mb-4 flex gap-2" action="/resources" method="get">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search by name…" className="max-w-xs" />
        <Input name="type" defaultValue={type ?? ""} placeholder="Filter type (postgresql…)" className="max-w-xs" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={<Boxes className="h-6 w-6" />} title="No resources" hint="Connect a Coolify instance and sync to discover resources." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Backup settings</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const agentDown = !liveInstanceIds.has(r.instanceId);
                  const isControlPlane = r.coolifyUuid.startsWith("coolify-self");

                  // No live agent -> the whole row is blurred and non-interactive,
                  // with a centered "Agent unavailable" overlay.
                  if (agentDown) {
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td colSpan={6} className="p-0">
                          <div className="relative">
                            <div className="pointer-events-none flex select-none flex-wrap items-center gap-3 px-4 py-3 blur-[2px]">
                              <span className="font-medium">{r.name}</span>
                              <Badge>{r.type}</Badge>
                              <span className="text-xs text-muted-foreground">{r.projectName || "—"}</span>
                              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center px-4">
                              <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-warning)]">
                                <Unplug className="h-4 w-4 shrink-0" /> Agent unavailable — this resource can&apos;t be
                                backed up
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={r.id} className={`border-b align-middle last:border-0 ${isControlPlane ? "bg-muted/30" : ""}`}>
                      <td className="px-4 py-2.5 font-medium">
                        <a href={`/resources/${r.id}`} className="hover:underline">
                          {r.name}
                        </a>
                        {isControlPlane && (
                          <Badge tone="accent" className="ml-2">
                            <Pin className="h-3 w-3" /> control plane
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge>{r.type}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.projectName || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <ResourceToggles id={r.id} backupEnabled={r.backupEnabled} liveBackup={r.liveBackup} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ActionButton action={backupNow.bind(null, r.id)} variant="primary" size="sm" successMsg="Queued">
                          <Play className="h-3.5 w-3.5" /> Backup
                        </ActionButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile: one card per resource. */}
            <div className="divide-y md:hidden">
              {rows.map((r) => {
                const agentDown = !liveInstanceIds.has(r.instanceId);
                const isControlPlane = r.coolifyUuid.startsWith("coolify-self");
                if (agentDown) {
                  return (
                    <div key={r.id} className="flex flex-col gap-2 p-4 opacity-60">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.name}</span>
                        <Badge>{r.type}</Badge>
                      </div>
                      <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-warning)]">
                        <Unplug className="h-3.5 w-3.5 shrink-0" /> Agent unavailable
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={r.id} className={`flex flex-col gap-3 p-4 ${isControlPlane ? "bg-muted/30" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <a href={`/resources/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </a>
                      {isControlPlane && (
                        <Badge tone="accent">
                          <Pin className="h-3 w-3" /> control plane
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge>{r.type}</Badge>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      <span className="text-muted-foreground">{r.projectName || "—"}</span>
                    </div>
                    <ResourceToggles id={r.id} backupEnabled={r.backupEnabled} liveBackup={r.liveBackup} />
                    <ActionButton action={backupNow.bind(null, r.id)} variant="primary" size="sm" successMsg="Queued">
                      <Play className="h-3.5 w-3.5" /> Backup
                    </ActionButton>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total} resource{total === 1 ? "" : "s"} · page {page}/{totalPages}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <a href={qs(page - 1)} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              ← Prev
            </a>
          )}
          {page < totalPages && (
            <a href={qs(page + 1)} className="rounded-md border px-3 py-1.5 hover:bg-muted">
              Next →
            </a>
          )}
        </div>
      </div>

      {orphaned.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Removed from Coolify · {orphaned.length} — kept for their backups
          </summary>
          <Card className="mt-3">
            <CardContent className="p-0">
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Project</th>
                    <th className="px-4 py-2.5 font-medium">Snapshots</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {orphaned.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">
                        <a href={`/resources/${r.id}`} className="hover:underline">
                          {r.name}
                        </a>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge>{r.type}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.projectName || "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{r._count.snapshots}</td>
                      <td className="px-4 py-2.5 text-right">
                        <a href={`/resources/${r.id}`} className="text-xs text-accent hover:underline">
                          View / restore →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile: cards. */}
              <div className="divide-y md:hidden">
                {orphaned.map((r) => (
                  <a key={r.id} href={`/resources/${r.id}`} className="flex items-center justify-between gap-2 p-4">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.type} · {r._count.snapshots} snapshot{r._count.snapshots === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-accent">View →</span>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            These no longer exist in Coolify. You can&apos;t back them up, but their snapshots are kept — restore them
            (e.g. “→ new” to recreate the resource).
          </p>
        </details>
      )}
    </>
  );
}
