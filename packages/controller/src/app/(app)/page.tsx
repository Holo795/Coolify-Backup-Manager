import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, statusTone } from "@/components/ui";
import { formatBytes, timeAgo } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [instances, resources, enabled, snapshots, agentsOnline, recent] = await Promise.all([
    prisma.coolifyInstance.count(),
    prisma.resource.count(),
    prisma.resource.count({ where: { backupEnabled: true, excluded: false } }),
    prisma.snapshot.count({ where: { status: "succeeded" } }),
    prisma.agent.count({ where: { status: "online" } }),
    prisma.snapshot.findMany({
      orderBy: { startedAt: "desc" },
      take: 8,
      include: { resource: true },
    }),
  ]);

  const stats = [
    { label: "Coolify instances", value: instances, href: "/instances" },
    { label: "Resources", value: resources, href: "/resources" },
    { label: "Backup-enabled", value: enabled, href: "/resources" },
    { label: "Snapshots", value: snapshots, href: "/snapshots" },
    { label: "Agents online", value: agentsOnline, href: "/agents" },
  ];

  return (
    <>
      <PageHeader title="Overview" description="Backup posture across your Coolify fleet" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="h-full transition-colors hover:border-accent/50">
              <CardContent className="flex flex-col gap-2 p-5">
                <div className="text-3xl font-medium leading-none tabular-nums">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium text-muted-foreground">Recent snapshots</h2>
      <Card>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No snapshots yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Resource</th>
                  <th className="px-4 py-2.5 font-medium">Mode</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-medium">{s.resource.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {s.mode} · {s.captureMode}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatBytes(s.sizeBytes)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{timeAgo(s.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
