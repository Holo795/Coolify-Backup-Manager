import { open, stat } from "node:fs/promises";
import type { ResourceType, DbCredentials } from "@cbm/shared";
import { docker, dockerToFile, dockerFromFile } from "./docker.js";

/** Map a resource type to the dump engine label stored in the manifest. */
export function dumpEngine(type: ResourceType): string {
  return type;
}

/** Produce a logical dump of a database container into outFile. */
export async function dumpDatabase(
  type: ResourceType,
  container: string,
  db: DbCredentials,
  outFile: string,
): Promise<void> {
  const user = db.user ?? "";
  const password = db.password ?? "";
  const database = db.database ?? "";

  switch (type) {
    case "postgresql": {
      const args = ["exec"];
      if (password) args.push("-e", `PGPASSWORD=${password}`);
      args.push(container, "pg_dump", "-U", user || "postgres", "--clean", "--if-exists", "--no-owner");
      if (database) args.push("-d", database);
      await dockerToFile(args, outFile);
      return;
    }
    case "mysql":
    case "mariadb": {
      const args = ["exec"];
      if (password) args.push("-e", `MYSQL_PWD=${password}`);
      const tool = type === "mariadb" ? "mariadb-dump" : "mysqldump";
      args.push(container, "sh", "-c", buildMysqlDumpCmd(tool, user, database));
      await dockerToFile(args, outFile);
      return;
    }
    case "mongodb": {
      const cred =
        user && password ? `--username='${user}' --password='${password}' --authenticationDatabase=admin ` : "";
      const dbsel = database ? `--db='${database}' ` : "";
      const args = ["exec", container, "sh", "-c", `mongodump ${cred}${dbsel}--archive`];
      await dockerToFile(args, outFile);
      return;
    }
    default:
      throw new Error(`No logical dump supported for type ${type}`);
  }
}

function buildMysqlDumpCmd(tool: string, user: string, database: string): string {
  // Fall back to mysqldump if the preferred tool is missing.
  const u = user || "root";
  const dbpart = database ? `--databases '${database}'` : "--all-databases";
  return `(command -v ${tool} >/dev/null 2>&1 && ${tool} -u'${u}' ${dbpart}) || mysqldump -u'${u}' ${dbpart}`;
}

/**
 * Stream a consistent RDB snapshot of a Redis-family store (redis/keydb/
 * dragonfly) to outFile via the in-container CLI — no freeze, no disk write on
 * the server. Throws if no compatible CLI is present (caller falls back to a
 * volume copy). Auth goes through REDISCLI_AUTH so the password never lands in
 * the process args.
 */
export async function dumpRedis(container: string, password: string | undefined, outFile: string): Promise<void> {
  const args = ["exec"];
  if (password) args.push("-e", `REDISCLI_AUTH=${password}`);
  args.push(
    container,
    "sh",
    "-c",
    "(command -v redis-cli >/dev/null 2>&1 && redis-cli --no-auth-warning --rdb -) || " +
      "(command -v keydb-cli >/dev/null 2>&1 && keydb-cli --no-auth-warning --rdb -)",
  );
  await dockerToFile(args, outFile);
  // `redis-cli --rdb -` can exit 0 while streaming a truncated/empty payload on
  // some error paths. Validate the RDB magic so a useless dump can't be treated
  // as success (the caller then falls back to a frozen volume copy).
  if ((await stat(outFile)).size < 9) throw new Error("Redis RDB export is empty");
  const fh = await open(outFile, "r");
  try {
    const buf = Buffer.alloc(5);
    await fh.read(buf, 0, 5, 0);
    if (buf.toString("latin1") !== "REDIS") throw new Error("Redis RDB export has an invalid header");
  } finally {
    await fh.close();
  }
}

/** Create an empty database (used by restore-to-new for engines that support it). */
export async function createDatabase(
  type: ResourceType,
  container: string,
  db: DbCredentials,
  newName: string,
): Promise<void> {
  const user = db.user ?? "";
  const password = db.password ?? "";
  if (type === "postgresql") {
    const args = ["exec"];
    if (password) args.push("-e", `PGPASSWORD=${password}`);
    args.push(container, "psql", "-U", user || "postgres", "-d", "postgres", "-c", `CREATE DATABASE "${newName}"`);
    const r = await docker(args);
    if (r.code !== 0) throw new Error(`create database failed: ${r.stderr}`);
    return;
  }
  if (type === "mongodb") {
    // MongoDB creates databases lazily; nothing to do.
    return;
  }
  throw new Error(`Restore-to-new is not supported for ${type} (the dump pins the database name)`);
}

/** Restore a logical dump into a running database container. */
export async function restoreDatabase(
  type: ResourceType,
  container: string,
  db: DbCredentials,
  inFile: string,
): Promise<void> {
  const user = db.user ?? "";
  const password = db.password ?? "";
  const database = db.database ?? "";

  switch (type) {
    case "postgresql": {
      const args = ["exec", "-i"];
      if (password) args.push("-e", `PGPASSWORD=${password}`);
      args.push(container, "psql", "-U", user || "postgres");
      if (database) args.push("-d", database);
      await dockerFromFile(args, inFile);
      return;
    }
    case "mysql":
    case "mariadb": {
      const args = ["exec", "-i"];
      if (password) args.push("-e", `MYSQL_PWD=${password}`);
      const client = type === "mariadb" ? "mariadb" : "mysql";
      args.push(container, "sh", "-c", `(command -v ${client} >/dev/null 2>&1 && ${client} -u'${user || "root"}') || mysql -u'${user || "root"}'`);
      await dockerFromFile(args, inFile);
      return;
    }
    case "mongodb": {
      const cred =
        user && password ? `--username='${user}' --password='${password}' --authenticationDatabase=admin ` : "";
      const args = ["exec", "-i", container, "sh", "-c", `mongorestore ${cred}--archive --drop`];
      await dockerFromFile(args, inFile);
      return;
    }
    default:
      throw new Error(`No logical restore supported for type ${type}`);
  }
}
