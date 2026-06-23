import { NextResponse } from "next/server";
import { AgentRegisterRequest } from "@cbm/shared";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { randomToken, sha256Hex } from "@/lib/crypto";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = AgentRegisterRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  // Zero-config: a per-instance enrollment token both authenticates the agent
  // AND identifies which Coolify instance it serves -> auto-link, no INSTANCE_UUID.
  let instanceId: string | undefined;
  const byToken = await prisma.coolifyInstance.findFirst({ where: { enrollToken: data.enrollmentToken } });
  if (byToken) {
    instanceId = byToken.id;
  } else {
    // Fallback: a global enrollment token (manual link via UI later).
    if (env.enrollmentToken && data.enrollmentToken !== env.enrollmentToken) {
      return NextResponse.json({ error: "invalid enrollment token" }, { status: 401 });
    }
    if (data.instanceUuid) {
      const inst = await prisma.coolifyInstance.findFirst({ where: { id: data.instanceUuid } });
      instanceId = inst?.id;
    }
  }

  const token = randomToken();
  const agent = await prisma.agent.create({
    data: {
      hostname: data.hostname,
      tokenHash: sha256Hex(token),
      instanceId,
      status: "online",
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ agentId: agent.id, agentToken: token });
}
