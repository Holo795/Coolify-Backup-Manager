import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Badge, Button, statusTone, EmptyState } from "@/components/ui";
import { deleteAgent } from "@/app/actions";
import { timeAgo } from "@/lib/cn";
import { Cpu, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "asc" }, include: { instance: true } });

  return (
    <>
      <PageHeader
        title="Agents"
        description="One per Docker host. Agents auto-enroll and self-link when you connect a Coolify instance."
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={<Cpu className="h-6 w-6" />}
          title="No agents connected"
          hint="Connect a Coolify instance with “Auto-deploy” enabled, or use its one-line install command — the agent links itself."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Host</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Instance</th>
                  <th className="px-4 py-2.5 font-medium">Docker</th>
                  <th className="px-4 py-2.5 font-medium">Containers</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-medium">{a.hostname}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {a.instance ? (
                        <Link href="/instances" className="hover:underline">
                          {a.instance.name}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-warning)]">unlinked</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.dockerVersion ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{a.containers ?? 0}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{timeAgo(a.lastSeenAt)}</td>
                    <td className="px-4 py-2.5">
                      <form action={deleteAgent.bind(null, a.id)}>
                        <Button size="sm" variant="danger" type="submit" aria-label="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        Agents are deployed and configured from the{" "}
        <Link href="/instances" className="text-accent hover:underline">
          Coolify instances
        </Link>{" "}
        page — each instance has its own enrollment token, so agents link themselves automatically.
      </p>
    </>
  );
}
