import { headers as nextHeaders } from "next/headers";
import { prisma } from "./prisma";
import { sha256Hex } from "./crypto";
import type { Agent } from "@/generated/prisma/client";

/** Resolve the Agent from the Authorization: Bearer <token> header. */
export async function authenticateAgent(): Promise<Agent | null> {
  const h = await nextHeaders();
  const auth = h.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const tokenHash = sha256Hex(m[1].trim());
  const agent = await prisma.agent.findUnique({ where: { tokenHash } });
  return agent;
}

/** Same, but reads the token from an explicit Request (route handlers). */
export async function authenticateAgentFromRequest(req: Request): Promise<Agent | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const tokenHash = sha256Hex(m[1].trim());
  return prisma.agent.findUnique({ where: { tokenHash } });
}
