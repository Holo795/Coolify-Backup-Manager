import { NextResponse } from "next/server";
import { JobEvent } from "@cbm/shared";
import { prisma } from "@/lib/prisma";
import { authenticateAgentFromRequest } from "@/lib/agent-auth";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await authenticateAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const job = await prisma.agentJob.findUnique({ where: { id } });
  if (!job || job.agentId !== agent.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const parsed = JobEvent.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid event" }, { status: 400 });
  const e = parsed.data;

  await prisma.jobEvent.create({
    data: {
      jobId: id,
      level: e.level,
      message: e.message,
      progress: e.progress !== undefined ? Math.round(e.progress) : null,
      ts: new Date(e.ts),
    },
  });
  return NextResponse.json({ ok: true });
}
