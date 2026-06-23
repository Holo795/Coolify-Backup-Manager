/* Reaper (offline + stuck-job) and destination test-connection (real SFTP/S3). */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { reaper } from "@/lib/reaper";
import { testDestination } from "@/lib/destination-test";

/* ---- Reaper ---- */
const res = await prisma.resource.findFirstOrThrow();
const dest = await prisma.destination.findFirstOrThrow();
const agent = await prisma.agent.create({
  data: { hostname: "reap-test", tokenHash: "reap-" + res.id, status: "online", lastSeenAt: new Date(Date.now() - 200_000) },
});
const snap = await prisma.snapshot.create({
  data: { resourceId: res.id, destinationId: dest.id, mode: "backup", captureMode: "cold", status: "running", destinationDir: "reap/x" },
});
await prisma.agentJob.create({
  data: { agentId: agent.id, type: "backup", status: "running", payload: {}, snapshotId: snap.id, claimedAt: new Date(Date.now() - 200_000) },
});
const r = await reaper(new Date(), { offlineMs: 90_000, stuckMs: 90_000 });
const a2 = await prisma.agent.findUnique({ where: { id: agent.id } });
const s2 = await prisma.snapshot.findUnique({ where: { id: snap.id } });
console.log(`reaper: offline=${r.offline} stuck=${r.stuck} | reap-agent=${a2?.status} reap-snap=${s2?.status}`);
const reaperPass = a2?.status === "offline" && s2?.status === "failed" && r.offline >= 1 && r.stuck >= 1;
await prisma.snapshot.delete({ where: { id: snap.id } }).catch(() => {});
await prisma.agent.delete({ where: { id: agent.id } }).catch(() => {});

/* ---- Destination test-connection ---- */
const local = await testDestination({ type: "local", basePath: "/tmp/cbm-test/dttest" });
const ssh = await testDestination({ type: "ssh", host: "localhost", port: 2222, username: "backupuser", password: "backuppass", basePath: "/upload" });
const s3 = await testDestination({ type: "s3", endpoint: "http://localhost:9000", region: "us-east-1", bucket: "cbm-backups", prefix: "", accessKeyId: "minioadmin", secretAccessKey: "minioadmin", forcePathStyle: true });
const bad = await testDestination({ type: "ssh", host: "localhost", port: 2222, username: "backupuser", password: "WRONG", basePath: "/upload" });
console.log(`local: ${JSON.stringify(local)}`);
console.log(`ssh:   ${JSON.stringify(ssh)}`);
console.log(`s3:    ${JSON.stringify(s3)}`);
console.log(`bad:   ${JSON.stringify(bad)}`);
const destPass = local.ok && ssh.ok && s3.ok && !bad.ok;

console.log("---");
console.log(`REAPER (offline + stuck): ${reaperPass ? "PASS" : "FAIL"}`);
console.log(`DESTINATION TEST-CONN:    ${destPass ? "PASS" : "FAIL"}`);
process.exit(reaperPass && destPass ? 0 : 1);
