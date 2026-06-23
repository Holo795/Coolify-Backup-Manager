/* Validates instance->resource schedule inheritance + scheduler tick. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tick } from "@/lib/scheduler";
import { effectivePolicy } from "@/lib/schedule";

const inst = await prisma.coolifyInstance.findFirstOrThrow({ where: { name: "real-coolify" } });
const dest = await prisma.destination.findFirstOrThrow();
const res = await prisma.resource.findFirstOrThrow({ where: { instanceId: inst.id } });

// Instance schedule whose cron matches the current minute (so tick() fires).
const now = new Date();
const cron = `${now.getUTCMinutes()} ${now.getUTCHours()} * * *`;
await prisma.backupPolicy.deleteMany({ where: { instanceId: inst.id, resourceId: null } });
await prisma.backupPolicy.deleteMany({ where: { resourceId: res.id } });
await prisma.backupPolicy.create({
  data: { name: "test sched", instanceId: inst.id, destinationId: dest.id, cron, mode: "backup", retentionDaily: 7, retentionWeekly: 4, retentionMonthly: 6 },
});
console.log(`instance schedule created (cron=${cron})`);

// Resource should INHERIT the instance schedule.
const eff = await effectivePolicy(res.id);
console.log(`resource '${res.name}' effective schedule source=${eff.source}, dest=${eff.policy?.destination.name}`);

// Scheduler tick should enqueue a backup for the inherited resource.
const before = await prisma.snapshot.count({ where: { resourceId: res.id } });
const triggered = await tick(now);
const after = await prisma.snapshot.count({ where: { resourceId: res.id } });
console.log(`tick triggered=${triggered}, snapshots ${before} -> ${after}`);

// Now add a resource OVERRIDE and confirm precedence.
await prisma.backupPolicy.create({
  data: { name: "override", resourceId: res.id, destinationId: dest.id, cron: "0 5 * * *", mode: "sync", retentionDaily: 3, retentionWeekly: 0, retentionMonthly: 0 },
});
const eff2 = await effectivePolicy(res.id);
console.log(`after override: source=${eff2.source}, mode=${eff2.policy?.mode}`);

const pass = eff.source === "instance" && triggered >= 1 && after > before && eff2.source === "resource" && eff2.policy?.mode === "sync";
console.log(pass ? "SCHEDULE INHERITANCE + OVERRIDE: PASS" : "SCHEDULE INHERITANCE + OVERRIDE: FAIL");
process.exit(pass ? 0 : 1);
