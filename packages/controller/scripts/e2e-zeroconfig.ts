/* Zero-config: per-instance enrollment token (auto-link) + Coolify-API agent deploy. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { syncInstance } from "@/lib/discovery";
import { CoolifyClient } from "@/lib/coolify";

const token = readFileSync("/tmp/cbm-test/coolify-token.txt", "utf8").trim();
const baseUrl = "http://localhost:8000";

await prisma.agent.deleteMany({ where: { hostname: "zeroconf-host" } });
await prisma.coolifyInstance.deleteMany({ where: { name: "real-coolify" } });
const inst = await prisma.coolifyInstance.create({
  data: { name: "real-coolify", baseUrl, apiTokenEnc: encryptSecret(token), enrollToken: randomToken() },
});
console.log(`instance created (enrollToken=${inst.enrollToken.slice(0, 8)}…)`);
const synced = await syncInstance(inst.id);
console.log(`synced ${synced.synced} resource(s)`);

// 1) Coolify-API agent deploy integration
const client = new CoolifyClient(baseUrl, token);
try {
  const r = await client.deployAgent({
    image: "cbm-agent",
    tag: "local",
    controllerUrl: "http://host.docker.internal:3000",
    enrollToken: inst.enrollToken,
  });
  console.log(`DEPLOY: created agent resource in Coolify uuid=${r.uuid}`);
  await prisma.coolifyInstance.update({ where: { id: inst.id }, data: { agentResourceUuid: r.uuid, agentDeployStatus: "deployed" } });
} catch (e) {
  console.log(`DEPLOY: ${(e as Error).message}`);
}

// 2) Zero-config auto-link: register with the instance token, NO instanceUuid
const res = await fetch("http://localhost:3000/api/agents/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ enrollmentToken: inst.enrollToken, hostname: "zeroconf-host" }),
});
const body = (await res.json()) as { agentId?: string };
const agent = body.agentId
  ? await prisma.agent.findUnique({ where: { id: body.agentId }, include: { instance: true } })
  : null;
console.log(`register status=${res.status}, linked to: ${agent?.instance?.name ?? "(none)"}`);
console.log(agent?.instance?.name === "real-coolify" ? "ZERO-CONFIG AUTOLINK: PASS" : "ZERO-CONFIG AUTOLINK: FAIL");
process.exit(0);
