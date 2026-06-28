import { NextResponse } from "next/server";
import { JobResult } from "@cbm/shared";
import { prisma } from "@/lib/prisma";
import { authenticateAgentFromRequest } from "@/lib/agent-auth";
import { notifyBackupFailed, notifyMissingBackups } from "@/lib/notify";

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
          // The agent's manifest is authoritative for how it actually captured
          // (e.g. a Redis resource dumped logically, not frozen).
          captureMode: m.captureMode,
          resticSnapshotId: result.resticSnapshotId ?? m.resticSnapshotId ?? undefined,
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
      await notifyBackupFailed(job.snapshotId).catch(() => undefined);
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

  if (job.type === "verify-destination" && result.verify) {
    const payload = job.payload as { destinationId?: string; engine?: string } | null;
    const destinationId = payload?.destinationId;
    const isRestic = payload?.engine === "restic";
    const now = new Date();
    const present = result.verify.present;
    const missing = result.verify.missing;
    // present/missing carry restic snapshot ids (restic engine) or snapshot
    // directories (tar engine) - match snapshots on the matching column.
    const match = (vals: string[]) =>
      isRestic ? { resticSnapshotId: { in: vals } } : { destinationDir: { in: vals } };
    if (destinationId) {
      if (present.length) {
        // Confirmed present: refresh the check time, and un-flag any that had
        // been marked missing but reappeared.
        await prisma.snapshot.updateMany({ where: { destinationId, ...match(present) }, data: { lastCheckedAt: now } });
        await prisma.snapshot.updateMany({
          where: { destinationId, ...match(present), status: "missing" },
          data: { status: "succeeded" },
        });
      }
      if (missing.length) {
        // Newly missing = not already flagged - alert only on these.
        const newly = await prisma.snapshot.findMany({
          where: { destinationId, ...match(missing), status: { not: "missing" } },
          select: { id: true },
        });
        await prisma.snapshot.updateMany({
          where: { destinationId, ...match(missing) },
          data: { status: "missing", lastCheckedAt: now },
        });
        if (newly.length) await notifyMissingBackups(newly.map((s) => s.id)).catch(() => undefined);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
