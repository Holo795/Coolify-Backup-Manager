/* Discovery against a REAL Coolify instance running in Docker. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { syncInstance } from "@/lib/discovery";
import { CoolifyClient } from "@/lib/coolify";

const token = readFileSync("/tmp/cbm-test/coolify-token.txt", "utf8").trim();
const baseUrl = "http://localhost:8000";

const ping = await new CoolifyClient(baseUrl, token).ping();
console.log(`ping: ${JSON.stringify(ping)}`);

await prisma.coolifyInstance.deleteMany({ where: { name: "real-coolify" } });
const instance = await prisma.coolifyInstance.create({
  data: { name: "real-coolify", baseUrl, apiTokenEnc: encryptSecret(token) },
});

const result = await syncInstance(instance.id);
const resources = await prisma.resource.findMany({ where: { instanceId: instance.id }, orderBy: { name: "asc" } });
console.log(`synced=${result.synced}`);
for (const r of resources) {
  console.log(`  ${r.type.padEnd(12)} ${r.name.padEnd(20)} project=${r.projectName} env=${r.environment} uuid=${r.coolifyUuid}`);
}
const pass = resources.some((r) => r.type === "postgresql" && r.name === "cbm-real-pg");
console.log(pass ? "REAL COOLIFY DISCOVERY: PASS" : "REAL COOLIFY DISCOVERY: FAIL");
process.exit(pass ? 0 : 1);
