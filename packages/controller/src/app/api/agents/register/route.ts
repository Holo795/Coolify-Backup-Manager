import { NextResponse } from "next/server";
import { AgentRegisterRequest } from "@cbm/shared";
import { prisma } from "@/lib/prisma";
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
  // AND identifies which Coolify instance it serves -> auto-link. Only the sha256
  // hash is stored, so we match on the hash. A token that matches nothing
  // (rotated/revoked) is rejected so the agent reconfigures with a freshly
  // revealed install command.
  const byToken = await prisma.coolifyInstance.findFirst({
    where: { enrollTokenHash: sha256Hex(data.enrollmentToken) },
  });
  if (!byToken) {
    return NextResponse.json(
      { error: "enrollment token invalid or rotated - reveal a new install command in the controller" },
      { status: 401 },
    );
  }
  const instanceId = byToken.id;

  // Idempotent per host: one agent identity per (instance, hostname). Restarting
  // or re-running the install command reuses the same Agent row (and rotates its
  // bearer token) instead of accumulating duplicates.
  const token = randomToken();
  const existing = instanceId
    ? await prisma.agent.findFirst({ where: { instanceId, hostname: data.hostname } })
    : null;
  // Install-time server pin (AGENT_SERVER_UUID): forces the agent's server and
  // disables auto-detection.
  const serverPin = data.serverUuid
    ? { serverUuid: data.serverUuid, serverManual: true }
    : {};
  const agent = existing
    ? await prisma.agent.update({
        where: { id: existing.id },
        data: { tokenHash: sha256Hex(token), status: "online", lastSeenAt: new Date(), ...serverPin },
      })
    : await prisma.agent.create({
        data: {
          hostname: data.hostname,
          tokenHash: sha256Hex(token),
          instanceId,
          status: "online",
          lastSeenAt: new Date(),
          ...serverPin,
        },
      });

  return NextResponse.json({ agentId: agent.id, agentToken: token });
}
