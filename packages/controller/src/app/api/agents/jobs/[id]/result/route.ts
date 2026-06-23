import { NextResponse } from "next/server";
import { JobResult } from "@cbm/shared";
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

  const parsed = JobResult.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid result", details: parsed.error.issues }, { status: 400 });
  }
  const result = parsed.data;
  const succeeded = result.status === "succeeded";

  await prisma.agentJob.update({
    where: { id },
    data: { status: result.status, error: result.error, finishedAt: new Date() },
  });

  if (job.type === "backup" && job.snapshotId) {
    if (succeeded && result.manifest) {
      const m = result.manifest;
      const totalSize = m.artifacts.reduce((acc, a) => acc + (a.sizeBytes ?? 0), 0);
      await prisma.snapshot.update({
        where: { id: job.snapshotId },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          manifest: m as unknown as object,
          sizeBytes: BigInt(totalSize),
          artifacts: {
            create: m.artifacts.map((a) => ({
              kind: a.kind,
              filename: a.filename,
              sizeBytes: BigInt(a.sizeBytes ?? 0),
              sha256: a.sha256,
              encrypted: a.encrypted,
            })),
          },
        },
      });
      // Cache docker facts the agent resolved (containers/volumes).
      await prisma.resource
        .updateMany({
          where: { coolifyUuid: m.resource.coolifyUuid },
          data: {
            containerName: m.resource.containerName ?? undefined,
            containerNames: m.resource.containerNames,
            volumes: m.resource.volumes,
          },
        })
        .catch(() => undefined);
    } else {
      await prisma.snapshot.update({
        where: { id: job.snapshotId },
        data: { status: "failed", finishedAt: new Date(), error: result.error ?? "unknown error" },
      });
    }
  }

  if (job.type === "restore" && job.restoreId) {
    await prisma.restoreJob.update({
      where: { id: job.restoreId },
      data: {
        status: succeeded ? "succeeded" : "failed",
        error: result.error,
        finishedAt: new Date(),
      },
    });
  }

  return NextResponse.json({ ok: true });
}
