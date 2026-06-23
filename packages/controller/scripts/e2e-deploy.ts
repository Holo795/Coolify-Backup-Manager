import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { CoolifyClient } from "@/lib/coolify";
import { env } from "@/lib/env";

const token = readFileSync("/tmp/cbm-test/coolify-token.txt", "utf8").trim();
await prisma.coolifyInstance.deleteMany({ where: { name: "real-coolify" } });
const inst = await prisma.coolifyInstance.create({
  data: { name: "real-coolify", baseUrl: "http://localhost:8000", apiTokenEnc: encryptSecret(token), enrollToken: randomToken() },
});
const client = new CoolifyClient("http://localhost:8000", token);
console.log(`image=${env.agentImage}:${env.agentImageTag} controllerUrl=${env.agentControllerUrl || env.authUrl}`);
const r = await client.deployAgent({
  image: env.agentImage,
  tag: env.agentImageTag,
  controllerUrl: env.agentControllerUrl || env.authUrl,
  enrollToken: inst.enrollToken,
});
await prisma.coolifyInstance.update({ where: { id: inst.id }, data: { agentResourceUuid: r.uuid, agentDeployStatus: "deployed" } });
console.log(`DEPLOYED resource uuid=${r.uuid} instanceId=${inst.id}`);
process.exit(0);
