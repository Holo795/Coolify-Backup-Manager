import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { enqueueRestore } from "@/lib/jobs";

const snap = await prisma.snapshot.findFirst({
  where: { status: "succeeded" },
  orderBy: { startedAt: "desc" },
});
if (!snap) throw new Error("no succeeded snapshot");
const r = await enqueueRestore(snap.id, "in_place");
console.log(JSON.stringify({ snapshotId: snap.id, ...r }));
process.exit(0);
