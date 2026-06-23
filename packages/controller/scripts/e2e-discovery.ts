/* Validates CoolifyClient + syncInstance against a faithful mock of the
 * Coolify API (response shapes taken from a real Coolify v4 instance). */
import "dotenv/config";
import http from "node:http";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { syncInstance } from "@/lib/discovery";

const projects = [{ name: "USTS", environments: [{ id: 16, name: "production" }, { id: 22, name: "production" }] }];
const applications = [
  { uuid: "app-events", name: "Events List Club 1895", status: "running:healthy", environment_id: 22, build_pack: "dockerfile", git_repository: "https://gitlab/x.git", git_branch: "main" },
  { uuid: "app-api", name: "API", status: "exited:unhealthy", environment_id: 16, build_pack: "nixpacks" },
];
const databases = [
  { uuid: "db-events", name: "usts-events-db", database_type: "standalone-postgresql", status: "running:healthy", environment_id: 16 },
  { uuid: "db-mysql", name: "mysql-api", database_type: "standalone-mysql", status: "running:healthy", environment_id: 16 },
  { uuid: "db-redis", name: "redis", database_type: "standalone-redis", status: "running:healthy", environment_id: 16 },
];
const services = [{ uuid: "svc-wp", name: "wordpress", status: "running:healthy", environment_id: 16 }];

function json(res: http.ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (url.startsWith("/api/v1/version")) return json(res, "4.0.0-mock");
  if (url.startsWith("/api/v1/projects")) return json(res, projects);
  if (url.startsWith("/api/v1/applications")) return json(res, applications);
  if (url.startsWith("/api/v1/databases")) return json(res, databases);
  if (url.startsWith("/api/v1/services")) return json(res, services);
  res.writeHead(404);
  res.end("{}");
});

await new Promise<void>((r) => server.listen(8200, r));
const baseUrl = "http://localhost:8200";

// Clean prior mock instance.
await prisma.coolifyInstance.deleteMany({ where: { name: "mock-coolify" } });
const instance = await prisma.coolifyInstance.create({
  data: { name: "mock-coolify", baseUrl, apiTokenEnc: encryptSecret("mock-token") },
});

const result = await syncInstance(instance.id);
const resources = await prisma.resource.findMany({
  where: { instanceId: instance.id },
  orderBy: { name: "asc" },
});

console.log(`synced=${result.synced}`);
for (const r of resources) {
  console.log(`  ${r.type.padEnd(12)} ${r.name.padEnd(28)} project=${r.projectName} env=${r.environment} status=${r.status}`);
}

// Assertions
const byType = (t: string) => resources.filter((r) => r.type === t).length;
const ok =
  result.synced === 6 &&
  byType("application") === 2 &&
  byType("postgresql") === 1 &&
  byType("mysql") === 1 &&
  byType("redis") === 1 &&
  byType("service") === 1 &&
  resources.find((r) => r.coolifyUuid === "db-events")?.environment === "production";
console.log(ok ? "DISCOVERY TEST: PASS" : "DISCOVERY TEST: FAIL");

server.close();
process.exit(ok ? 0 : 1);
