import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/** Lightweight index for the command palette: names + ids of the things you can
 * jump to. Loaded once when the palette opens, then filtered client-side. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [resources, destinations, instances, agents] = await Promise.all([
    prisma.resource.findMany({
      where: { status: { not: "deleted" } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    prisma.destination.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
    prisma.coolifyInstance.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.agent.findMany({ select: { id: true, hostname: true }, orderBy: { hostname: "asc" } }),
  ]);

  return NextResponse.json({ resources, destinations, instances, agents });
}
