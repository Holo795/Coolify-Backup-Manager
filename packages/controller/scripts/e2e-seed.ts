/* E2E helper: seed an instance/destination/resource and enqueue a backup. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { enqueueBackup } from "@/lib/jobs";

const BASE = "/tmp/cbm-test/ctrl-backups";

const instance =
  (await prisma.coolifyInstance.findFirst({ where: { name: "local-test" } })) ??
  (await prisma.coolifyInstance.create({
    data: { name: "local-test", baseUrl: "http://dummy.local", apiTokenEnc: encryptSecret("dummy") },
  }));

const destination =
  (await prisma.destination.findFirst({ where: { name: "local-dest" } })) ??
  (await prisma.destination.create({
    data: {
      name: "local-dest",
      type: "local",
      configEnc: encryptSecret(JSON.stringify({ type: "local", basePath: BASE })),
      encryptionEnabled: false,
    },
  }));

const resource = await prisma.resource.upsert({
  where: { instanceId_coolifyUuid: { instanceId: instance.id, coolifyUuid: "cbm-pg-test" } },
  create: {
    instanceId: instance.id,
    coolifyUuid: "cbm-pg-test",
    name: "appdb",
    type: "postgresql",
    projectName: "test",
    status: "running:healthy",
    backupEnabled: true,
    captureMode: "hot",
    containerName: "cbm-pg-test",
    containerNames: ["cbm-pg-test"],
    volumes: [],
  },
  update: { backupEnabled: true, captureMode: "hot", containerName: "cbm-pg-test", containerNames: ["cbm-pg-test"] },
});

const r = await enqueueBackup(resource.id);
console.log(JSON.stringify({ instanceId: instance.id, destinationId: destination.id, resourceId: resource.id, ...r }));
process.exit(0);
