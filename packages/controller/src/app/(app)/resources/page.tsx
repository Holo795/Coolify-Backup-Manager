import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, Button, Input, Select, statusTone, EmptyState } from "@/components/ui";
import { updateResourceSettings, backupNow } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Boxes, Play } from "lucide-react";
import { DUMPABLE_DB_TYPES } from "@cbm/shared";

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
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(type ? { type } : {}),
  };
  const [total, resources] = await Promise.all([
    prisma.resource.count({ where }),
    prisma.resource.findMany({
      where,
      orderBy: [{ projectName: "asc" }, { name: "asc" }],
      include: { instance: true },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ]);
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

      {resources.length === 0 ? (
        <EmptyState icon={<Boxes className="h-6 w-6" />} title="No resources" hint="Connect a Coolify instance and sync to discover resources." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
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
                {resources.map((r) => {
                  const canHot = DUMPABLE_DB_TYPES.includes(r.type as never);
                  return (
                    <tr key={r.id} className="border-b last:border-0 align-middle">
                      <td className="px-4 py-2.5 font-medium">
                        <a href={`/resources/${r.id}`} className="hover:underline">
                          {r.name}
                        </a>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge>{r.type}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.projectName || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <form action={updateResourceSettings.bind(null, r.id)} className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" name="backupEnabled" defaultChecked={r.backupEnabled} /> on
                          </label>
                          <Select name="captureMode" defaultValue={r.captureMode} className="h-8 w-24 text-xs">
                            <option value="cold">cold</option>
                            <option value="hot" disabled={!canHot}>
                              hot
                            </option>
                          </Select>
                          <Button type="submit" size="sm" variant="outline">
                            Save
                          </Button>
                        </form>
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
    </>
  );
}
