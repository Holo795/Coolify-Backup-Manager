/**
 * Minimal Coolify API v4 client. Used by the controller to discover resources.
 * Endpoints used: /api/v1/{applications,databases,services,projects,resources}.
 */

export interface CoolifyResource {
  uuid: string;
  name: string;
  type: string; // normalized (postgresql, application, service, ...)
  rawType: string;
  status: string;
  projectName: string;
  environment: string;
  buildPack?: string;
  environmentId?: number;
}

export type DbEngine = "postgresql" | "mysql" | "mariadb" | "mongodb";

/** Subset of a Coolify standalone-database config we read/clone. */
export interface DbConfig {
  uuid: string;
  name: string;
  status?: string;
  image?: string;
  destination?: { server?: { uuid?: string } };
  [k: string]: unknown;
}

/** Map an original DB config to the per-engine credential fields for create. */
function dbCredsBody(type: DbEngine, src: DbConfig): Record<string, unknown> {
  switch (type) {
    case "postgresql":
      return { postgres_user: src.postgres_user, postgres_password: src.postgres_password, postgres_db: src.postgres_db };
    case "mysql":
      return {
        mysql_user: src.mysql_user,
        mysql_password: src.mysql_password,
        mysql_database: src.mysql_database,
        mysql_root_password: src.mysql_root_password,
      };
    case "mariadb":
      return {
        mariadb_user: src.mariadb_user,
        mariadb_password: src.mariadb_password,
        mariadb_database: src.mariadb_database,
        mariadb_root_password: src.mariadb_root_password,
      };
    case "mongodb":
      return {
        mongo_initdb_root_username: src.mongo_initdb_root_username,
        mongo_initdb_root_password: src.mongo_initdb_root_password,
        mongo_initdb_database: src.mongo_initdb_database,
      };
  }
}

export class CoolifyClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Coolify GET ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
    }
    return (await res.json()) as T;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Coolify PATCH ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Coolify POST ${path} -> ${res.status} ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Re-pin a Git application to a specific commit and redeploy, so the running
   * code matches restored data (avoids HEAD drift). The Coolify API stores
   * git_commit_sha = "HEAD" by default; this sets it to the captured SHA.
   */
  async repinCommit(appUuid: string, commitSha: string): Promise<void> {
    await this.patch(`/api/v1/applications/${appUuid}`, { git_commit_sha: commitSha });
    await this.get(`/api/v1/deploy?uuid=${appUuid}&force=true`);
  }

  /** Raw config of a standalone database resource. */
  async getDatabase(uuid: string): Promise<DbConfig> {
    return this.get<DbConfig>(`/api/v1/databases/${uuid}`);
  }

  /** Find a project's uuid by its display name. */
  async findProjectUuid(name: string): Promise<string | undefined> {
    const projects = await this.get<{ name: string; uuid: string }[]>("/api/v1/projects").catch(() => []);
    return (projects ?? []).find((p) => p.name === name)?.uuid;
  }

  /**
   * Clone a standalone database into a NEW Coolify resource: same project /
   * environment / server, same image + credentials, new name, deployed so it
   * can immediately receive a logical restore. Returns the new resource uuid.
   */
  async cloneDatabase(opts: {
    sourceUuid: string;
    type: DbEngine;
    newName: string;
    projectName: string;
    environmentName: string;
  }): Promise<string> {
    const src = await this.getDatabase(opts.sourceUuid);
    const serverUuid = src?.destination?.server?.uuid;
    if (!serverUuid) throw new Error("Could not resolve the source database's server for cloning");
    const projectUuid = await this.findProjectUuid(opts.projectName);
    if (!projectUuid) throw new Error(`Coolify project "${opts.projectName}" not found for cloning`);

    const body = {
      server_uuid: serverUuid,
      project_uuid: projectUuid,
      environment_name: opts.environmentName,
      name: opts.newName,
      image: src.image,
      instant_deploy: true,
      ...dbCredsBody(opts.type, src),
    };
    const created = await this.post<{ uuid?: string }>(`/api/v1/databases/${opts.type}`, body);
    if (!created?.uuid) throw new Error("Coolify did not return a uuid for the cloned database");
    return created.uuid;
  }

  /** Poll a database resource until its container reports running (or timeout). */
  async waitDatabaseRunning(uuid: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const d = await this.getDatabase(uuid).catch(() => null);
      if (d && /running/i.test(d.status ?? "")) return;
      if (Date.now() > deadline) throw new Error(`Cloned database not running after ${timeoutMs / 1000}s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /** Quick connectivity / auth check. The version endpoint returns plain text. */
  async ping(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/version`, {
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
      });
      const body = (await res.text()).trim();
      if (!res.ok) return { ok: false, error: `${res.status} ${body.slice(0, 200)}` };
      // Coolify may return JSON like {"message":"API is disabled."} with 200.
      if (body.startsWith("{")) {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) return { ok: false, error: parsed.message };
      }
      return { ok: true, version: body.replace(/^"|"$/g, "") };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async envMap(): Promise<Map<number, { project: string; environment: string }>> {
    const map = new Map<number, { project: string; environment: string }>();
    try {
      const projects = await this.get<any[]>("/api/v1/projects");
      for (const p of projects ?? []) {
        // The list endpoint usually omits nested environments; fetch detail.
        let envs = p.environments;
        let name = p.name;
        if ((!envs || envs.length === 0) && p.uuid) {
          const detail = await this.get<any>(`/api/v1/projects/${p.uuid}`).catch(() => null);
          if (detail) {
            envs = detail.environments ?? [];
            name = detail.name ?? name;
          }
        }
        for (const e of envs ?? []) {
          if (typeof e.id === "number") {
            map.set(e.id, { project: name ?? "", environment: e.name ?? "" });
          }
        }
      }
    } catch {
      /* projects endpoint optional */
    }
    return map;
  }

  /** Discover all resources, normalized. */
  async listResources(): Promise<CoolifyResource[]> {
    const envs = await this.envMap();
    const out: CoolifyResource[] = [];

    const apps = await this.get<any[]>("/api/v1/applications").catch(() => []);
    for (const a of apps ?? []) {
      out.push(this.normalize(a, "application", envs));
    }
    const dbs = await this.get<any[]>("/api/v1/databases").catch(() => []);
    for (const d of dbs ?? []) {
      out.push(this.normalize(d, undefined, envs));
    }
    const svcs = await this.get<any[]>("/api/v1/services").catch(() => []);
    for (const s of svcs ?? []) {
      out.push(this.normalize(s, "service", envs));
    }
    return out;
  }

  private normalize(
    r: any,
    forcedType: string | undefined,
    envs: Map<number, { project: string; environment: string }>,
  ): CoolifyResource {
    const rawType: string = forcedType ?? r.type ?? r.database_type ?? "unknown";
    const type = normalizeType(rawType);
    const envId: number | undefined = r.environment_id;
    const env = envId !== undefined ? envs.get(envId) : undefined;
    return {
      uuid: r.uuid,
      name: r.name ?? r.uuid,
      type,
      rawType,
      status: typeof r.status === "string" ? r.status : "unknown",
      projectName: env?.project ?? r.project_name ?? "",
      environment: env?.environment ?? "",
      buildPack: r.build_pack ?? undefined,
      environmentId: envId,
    };
  }
}

export function normalizeType(raw: string): string {
  const t = raw.replace(/^standalone-/, "");
  const known = [
    "postgresql",
    "mysql",
    "mariadb",
    "mongodb",
    "redis",
    "keydb",
    "dragonfly",
    "clickhouse",
    "application",
    "service",
  ];
  return known.includes(t) ? t : t;
}
