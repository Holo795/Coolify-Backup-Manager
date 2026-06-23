/* Multi-agent routing + sync-via-policy + retention pruning (real agents/files). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { enqueueBackup } from "@/lib/jobs";
import { applyRetention } from "@/lib/retention";

const ids = JSON.parse(readFileSync("/tmp/cbm-test/ma.json", "utf8"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitSnap(id: string) {
  for (let i = 0; i < 40; i++) {
    const s = await prisma.snapshot.findUnique({ where: { id } });
    if (s && s.status !== "running") return s;
    await sleep(1000);
  }
  return prisma.snapshot.findUnique({ where: { id } });
}

/* ---------- 1) Multi-agent routing ---------- */
const ra = await enqueueBackup(ids.resA);
const rb = await enqueueBackup(ids.resB);
const sa = await waitSnap(ra.snapshotId);
const sb = await waitSnap(rb.snapshotId);
const ja = await prisma.agentJob.findFirst({ where: { snapshotId: ra.snapshotId }, include: { agent: true } });
const jb = await prisma.agentJob.findFirst({ where: { snapshotId: rb.snapshotId }, include: { agent: true } });
console.log(`routing: resA -> ${ja?.agent.hostname} (${sa?.status}) ; resB -> ${jb?.agent.hostname} (${sb?.status})`);
const routingPass =
  sa?.status === "succeeded" && ja?.agent.hostname === "agent-a" &&
  sb?.status === "succeeded" && jb?.agent.hostname === "agent-b";

/* ---------- 2) Sync via policy ---------- */
await prisma.backupPolicy.deleteMany({ where: { resourceId: ids.resA } });
await prisma.backupPolicy.create({
  data: { name: "sync override", resourceId: ids.resA, destinationId: ids.destId, mode: "sync", cron: "0 2 * * *" },
});
const rs = await enqueueBackup(ids.resA);
const ss = await waitSnap(rs.snapshotId);
console.log(`sync: mode=${ss?.mode}, dir=${ss?.destinationDir}, status=${ss?.status}`);
const syncPass = ss?.status === "succeeded" && ss?.mode === "sync" && ss.destinationDir.endsWith("/sync");

/* ---------- 3) Retention pruning (real local files) ---------- */
// Use resB's snapshots; make 3 real backups already? Make 2 more so we have history.
const r1 = await enqueueBackup(ids.resB);
await waitSnap(r1.snapshotId);
const r2 = await enqueueBackup(ids.resB);
await waitSnap(r2.snapshotId);
// Attach them to a retention policy and spread their dates to simulate history.
await prisma.backupPolicy.deleteMany({ where: { instanceId: ids.instB, resourceId: null } });
const pol = await prisma.backupPolicy.create({
  data: { name: "retention", instanceId: ids.instB, destinationId: ids.destId, mode: "backup",
    cron: "0 2 * * *", retentionDaily: 1, retentionWeekly: 0, retentionMonthly: 0 },
});
const snaps = await prisma.snapshot.findMany({ where: { resourceId: ids.resB, status: "succeeded" }, orderBy: { startedAt: "desc" } });
// today, yesterday, 40 days ago
const days = [0, 1, 40];
for (let i = 0; i < snaps.length && i < 3; i++) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days[i]);
  await prisma.snapshot.update({ where: { id: snaps[i].id }, data: { startedAt: d, policyId: pol.id } });
}
const dirs = snaps.slice(0, 3).map((s) => `/tmp/cbm-test/ctrl-backups/${s.destinationDir}`);
const beforeDirs = dirs.map((d) => existsSync(d));
const beforeCount = await prisma.snapshot.count({ where: { resourceId: ids.resB } });
const pruned = await applyRetention(pol.id);
const afterCount = await prisma.snapshot.count({ where: { resourceId: ids.resB } });
const afterDirs = dirs.map((d) => existsSync(d));
console.log(`retention: snapshots ${beforeCount} -> ${afterCount}, deleted=${pruned.deleted}`);
console.log(`retention dirs existed=${JSON.stringify(beforeDirs)} now=${JSON.stringify(afterDirs)}`);
const retentionPass = pruned.deleted >= 2 && afterCount === beforeCount - pruned.deleted && afterDirs.filter(Boolean).length < beforeDirs.filter(Boolean).length;

console.log("---");
console.log(`MULTI-AGENT ROUTING: ${routingPass ? "PASS" : "FAIL"}`);
console.log(`SYNC VIA POLICY:     ${syncPass ? "PASS" : "FAIL"}`);
console.log(`RETENTION PRUNING:   ${retentionPass ? "PASS" : "FAIL"}`);
process.exit(routingPass && syncPass && retentionPass ? 0 : 1);
