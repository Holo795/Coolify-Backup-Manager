import { NextResponse } from "next/server";
import { HeartbeatRequest } from "@cbm/shared";
import { prisma } from "@/lib/prisma";
import { authenticateAgentFromRequest } from "@/lib/agent-auth";

export async function POST(req: Request) {
  const agent = await authenticateAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = HeartbeatRequest.safeParse(body);
  const data = parsed.success ? parsed.data : {};

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      status: "online",
      lastSeenAt: new Date(),
      dockerVersion: data.dockerVersion ?? agent.dockerVersion,
      containers: data.containers ?? agent.containers,
    },
  });
  return NextResponse.json({ ok: true });
}
