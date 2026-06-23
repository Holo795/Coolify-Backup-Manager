/* Setup for multi-agent / sync / retention tests (real containers referenced). */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { encryptSecret, randomToken } from "@/lib/crypto";

await prisma.agent.deleteMany({});
await prisma.coolifyInstance.deleteMany({ where: { name: { in: ["host-a", "host-b"] } } });

const dest =
  (await prisma.destination.findFirst({ where: { name: "local-dest" } })) ??
  (await prisma.destination.create({
    data: {
      name: "local-dest",
      type: "local",
      configEnc: encryptSecret(JSON.stringify({ type: "local", basePath: "/tmp/cbm-test/ctrl-backups" })),
      encryptionEnabled: false,
    },
  }));

async function mkInstance(name: string) {
  return prisma.coolifyInstance.create({
    data: { name, baseUrl: "http://localhost:8000", apiTokenEnc: encryptSecret("x"), enrollToken: randomToken() },
  });
}
const a = await mkInstance("host-a");
const b = await mkInstance("host-b");

const resA = await prisma.resource.create({
  data: { instanceId: a.id, coolifyUuid: "res-a-mysql", name: "res-a", type: "mysql", status: "running:healthy",
    containerName: "cbm-mysql", containerNames: ["cbm-mysql"], volumes: [] },
});
const resB = await prisma.resource.create({
  data: { instanceId: b.id, coolifyUuid: "res-b-mongo", name: "res-b", type: "mongodb", status: "running:healthy",
    containerName: "cbm-mongo", containerNames: ["cbm-mongo"], volumes: [] },
});

console.log(JSON.stringify({ tokenA: a.enrollToken, tokenB: b.enrollToken, instA: a.id, instB: b.id, resA: resA.id, resB: resB.id, destId: dest.id }));
process.exit(0);
