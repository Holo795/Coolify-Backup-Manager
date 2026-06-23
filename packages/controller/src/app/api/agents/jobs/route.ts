import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgentFromRequest } from "@/lib/agent-auth";

/** Long-poll: return the next queued job for this agent, or 204 when idle. */
export async function GET(req: Request) {
  const agent = await authenticateAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.agent.update({
    where: { id: agent.id },
    data: { status: "online", lastSeenAt: new Date() },
  });

  const job = await prisma.agentJob.findFirst({
    where: { agentId: agent.id, status: "queued" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) return new NextResponse(null, { status: 204 });

  await prisma.agentJob.update({
    where: { id: job.id },
    data: { status: "running", claimedAt: new Date() },
  });

  return NextResponse.json({ job: job.payload });
}
