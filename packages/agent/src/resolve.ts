import type { ResourceDescriptor, DbCredentials, ResourceType } from "@cbm/shared";
import { docker, inspectContainer } from "./docker.js";
import { logger } from "./logger.js";

/**
 * Resolve the concrete Docker facts (containers, volumes, DB credentials) for a
 * Coolify resource from its UUID. The controller only knows the UUID + type;
 * the agent discovers the rest from the local Docker daemon.
 */
export async function resolveResource(resource: ResourceDescriptor): Promise<ResourceDescriptor> {
  const r: ResourceDescriptor = { ...resource };

  // Special case: Coolify control-plane self-backup.
  if (resource.coolifyUuid.startsWith("coolify-self")) {
    const names = await listLines(["ps", "--format", "{{.Names}}"]);
    for (const name of names) {
      const info = await inspectContainer(name);
      const image: string = info?.Config?.Image ?? "";
      const env = parseEnv(info?.Config?.Env ?? []);
      if (image.toLowerCase().includes("postgres") && (env.POSTGRES_DB === "coolify" || env.POSTGRES_USER === "coolify")) {
        r.containerName = name;
        r.containerNames = [name];
        r.db = { user: env.POSTGRES_USER || "coolify", password: env.POSTGRES_PASSWORD || "", database: env.POSTGRES_DB || "coolify" };
        break;
      }
    }
    const vols = await listLines(["volume", "ls", "--format", "{{.Name}}"]);
    r.volumes = vols.filter((v) => {
      const l = v.toLowerCase();
      return l.includes("coolify") && l.includes("data") && !l.includes("-db") && !l.includes("redis");
    });
    logger.debug(`coolify-self resolved: container=${r.containerName} volumes=${r.volumes.join(",")}`);
    return r;
  }

  // Volumes: any volume whose name contains the (dash-stripped) uuid.
  const uuid = resource.coolifyUuid.replace(/-/g, "");
  if (r.volumes.length === 0) {
    const vols = await listLines(["volume", "ls", "--format", "{{.Name}}"]);
    r.volumes = vols.filter((v) => v.includes(uuid));
  }

  // Containers: those using one of the volumes, plus name/label matches.
  const containerSet = new Set<string>(r.containerNames);
  for (const v of r.volumes) {
    for (const c of await listLines(["ps", "-a", "--filter", `volume=${v}`, "--format", "{{.Names}}"])) {
      containerSet.add(c);
    }
  }
  for (const c of await listLines(["ps", "-a", "--filter", `name=${uuid}`, "--format", "{{.Names}}"])) {
    containerSet.add(c);
  }
  for (const labelKey of ["coolify.resourceUuid", "coolify.name", "coolify.applicationId", "coolify.serviceId"]) {
    for (const c of await listLines([
      "ps",
      "-a",
      "--filter",
      `label=${labelKey}=${resource.coolifyUuid}`,
      "--format",
      "{{.Names}}",
    ])) {
      containerSet.add(c);
    }
  }

  r.containerNames = [...containerSet];
  if (!r.containerName && r.containerNames.length > 0) {
    // Prefer a container whose image matches the DB type, else the first.
    r.containerName = (await pickPrimary(r.containerNames, resource.type)) ?? r.containerNames[0];
  }

  // DB credentials from the primary container's environment.
  if (!r.db && r.containerName) {
    r.db = await readDbCredentials(r.containerName, resource.type);
  }

  logger.debug(
    `Resolved ${resource.coolifyUuid}: containers=${r.containerNames.join(",")} volumes=${r.volumes.join(",")}`,
  );
  return r;
}

async function pickPrimary(containers: string[], type: ResourceType): Promise<string | undefined> {
  const hints: Record<string, string[]> = {
    postgresql: ["postgres"],
    mysql: ["mysql"],
    mariadb: ["mariadb", "mysql"],
    mongodb: ["mongo"],
    redis: ["redis"],
    keydb: ["keydb"],
    dragonfly: ["dragonfly"],
    clickhouse: ["clickhouse"],
  };
  const want = hints[type];
  if (!want) return undefined;
  for (const c of containers) {
    const info = await inspectContainer(c);
    const image: string = info?.Config?.Image ?? "";
    if (want.some((w) => image.toLowerCase().includes(w))) return c;
  }
  return undefined;
}

async function readDbCredentials(container: string, type: ResourceType): Promise<DbCredentials | undefined> {
  const info = await inspectContainer(container);
  const envArr: string[] = info?.Config?.Env ?? [];
  const env: Record<string, string> = {};
  for (const e of envArr) {
    const i = e.indexOf("=");
    if (i > 0) env[e.slice(0, i)] = e.slice(i + 1);
  }
  switch (type) {
    case "postgresql":
      return {
        user: env.POSTGRES_USER || "postgres",
        password: env.POSTGRES_PASSWORD || env.PGPASSWORD || "",
        database: env.POSTGRES_DB || env.POSTGRES_USER || "postgres",
      };
    case "mysql":
      // Use root for dump/restore — it needs CREATE DATABASE + full privileges.
      return {
        user: "root",
        password: env.MYSQL_ROOT_PASSWORD || env.MYSQL_PASSWORD || "",
        database: env.MYSQL_DATABASE || "",
      };
    case "mariadb":
      return {
        user: "root",
        password: env.MARIADB_ROOT_PASSWORD || env.MYSQL_ROOT_PASSWORD || env.MARIADB_PASSWORD || "",
        database: env.MARIADB_DATABASE || env.MYSQL_DATABASE || "",
      };
    case "mongodb":
      return {
        user: env.MONGO_INITDB_ROOT_USERNAME || "",
        password: env.MONGO_INITDB_ROOT_PASSWORD || "",
        database: env.MONGO_INITDB_DATABASE || "",
      };
    default:
      return undefined;
  }
}

function parseEnv(arr: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const e of arr) {
    const i = e.indexOf("=");
    if (i > 0) env[e.slice(0, i)] = e.slice(i + 1);
  }
  return env;
}

async function listLines(args: string[]): Promise<string[]> {
  const r = await docker(args);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
