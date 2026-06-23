import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { enqueueBackup } from "@/lib/jobs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inst = await prisma.coolifyInstance.findFirstOrThrow({ where: { name: "real-coolify" } });

const resource = await prisma.resource.upsert({
  where: { instanceId_coolifyUuid: { instanceId: inst.id, coolifyUuid: `coolify-self-${inst.id}` } },
  create: {
    instanceId: inst.id, coolifyUuid: `coolify-self-${inst.id}`, name: "Coolify control plane",
    type: "postgresql", projectName: "Coolify", status: "running:healthy", captureMode: "hot", backupEnabled: true,
  },
  update: {},
});

const r = await enqueueBackup(resource.id);
let snap = null;
for (let i = 0; i < 40; i++) {
  snap = await prisma.snapshot.findUnique({ where: { id: r.snapshotId } });
  if (snap && snap.status !== "running") break;
  await sleep(1000);
}
const m = snap?.manifest as { artifacts?: { kind: string; filename: string }[] } | null;
console.log(`coolify self-backup status=${snap?.status}, size=${snap?.sizeBytes}`);
console.log(`artifacts=${JSON.stringify(m?.artifacts?.map((a) => a.kind))}`);
const pass =
  snap?.status === "succeeded" &&
  !!m?.artifacts?.some((a) => a.kind === "db-dump") &&
  !!m?.artifacts?.some((a) => a.kind === "volume");
console.log(pass ? "COOLIFY SELF-BACKUP (controller->deployed agent): PASS" : "COOLIFY SELF-BACKUP: FAIL");
process.exit(pass ? 0 : 1);
