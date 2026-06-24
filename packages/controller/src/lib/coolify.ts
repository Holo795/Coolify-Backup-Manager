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

/** All standalone-database engines Coolify can create via the API. */
export type CloneEngine = DbEngine | "redis" | "keydb" | "dragonfly" | "clickhouse";

/** Map an original DB config to the per-engine credential fields for create. */
function dbCredsBody(type: CloneEngine, src: DbConfig): Record<string, unknown> {
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
    case "redis":
      return { redis_password: src.redis_password, redis_conf: src.redis_conf };
    case "keydb":
      return { keydb_password: src.keydb_password, keydb_conf: src.keydb_conf };
    case "dragonfly":
      return { dragonfly_password: src.dragonfly_password };
    case "clickhouse":
      return {
        clickhouse_admin_user: src.clickhouse_admin_user,
        clickhouse_admin_password: src.clickhouse_admin_password,
      };
  }
}

/** Drop undefined/null keys so Coolify create endpoints get a clean body. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
}

/**
 * Split an image reference into name + tag. Handles registries with ports
 * ("reg:5000/org/name:tag") and digest refs ("org/name@sha256:..."), where the
 * tag is dropped in favour of the digest's source tag if any.
 */
export function parseImageRef(ref?: string): { name?: string; tag?: string } {
  if (!ref) return {};
  const at = ref.indexOf("@");
  const core = at >= 0 ? ref.slice(0, at) : ref; // ignore "@sha256:..." digest
  const slash = core.lastIndexOf("/");
  const colon = core.lastIndexOf(":");
  if (colon > slash) return { name: core.slice(0, colon), tag: core.slice(colon + 1) };
  return { name: core };
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

  /**
   * Authoritative dump/restore credentials for a database, read from Coolify's
   * config (the container env isn't always reliably introspectable). mysql /
   * mariadb use root so the dump has full privileges.
   */
  async getDbCredentials(
    uuid: string,
    type: DbEngine,
  ): Promise<{ user?: string; password?: string; database?: string } | undefined> {
    const s = await this.getDatabase(uuid).catch(() => null);
    if (!s) return undefined;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    switch (type) {
      case "postgresql":
        return { user: str(s.postgres_user), password: str(s.postgres_password), database: str(s.postgres_db) };
      case "mysql":
        return { user: "root", password: str(s.mysql_root_password), database: str(s.mysql_database) };
      case "mariadb":
        return {
          user: "root",
          password: str(s.mariadb_root_password) ?? str(s.mysql_root_password),
          database: str(s.mariadb_database) ?? str(s.mysql_database),
        };
      case "mongodb":
        return {
          user: str(s.mongo_initdb_root_username),
          password: str(s.mongo_initdb_root_password),
          database: str(s.mongo_initdb_database),
        };
    }
  }

  /** Find a project's uuid by its display name. */
  async findProjectUuid(name: string): Promise<string | undefined> {
    const projects = await this.get<{ name: string; uuid: string }[]>("/api/v1/projects").catch(() => []);
    return (projects ?? []).find((p) => p.name === name)?.uuid;
  }

  /**
   * Clone a standalone database into a NEW Coolify resource: same project /
   * environment / server, same image + credentials, new name. `instantDeploy`
   * is true for logical-dump restores (the clone must be running to load the
   * dump) and false for volume-based restores (we pre-fill the volume, then the
   * operator deploys). Returns the new resource uuid.
   */
  async cloneDatabase(opts: {
    sourceUuid: string;
    type: CloneEngine;
    newName: string;
    projectName: string;
    environmentName: string;
    instantDeploy: boolean;
  }): Promise<string> {
    const src = await this.getDatabase(opts.sourceUuid);
    const serverUuid = src?.destination?.server?.uuid;
    if (!serverUuid) throw new Error("Could not resolve the source database's server for cloning");
    const projectUuid = await this.findProjectUuid(opts.projectName);
    if (!projectUuid) throw new Error(`Coolify project "${opts.projectName}" not found for cloning`);

    const body = compact({
      server_uuid: serverUuid,
      project_uuid: projectUuid,
      environment_name: opts.environmentName,
      name: opts.newName,
      image: src.image,
      instant_deploy: opts.instantDeploy,
      ...dbCredsBody(opts.type, src),
    });
    const created = await this.post<{ uuid?: string }>(`/api/v1/databases/${opts.type}`, body);
    if (!created?.uuid) throw new Error("Coolify did not return a uuid for the cloned database");
    return created.uuid;
  }

  /** Raw config of an application / service resource. */
  async getApplication(uuid: string): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(`/api/v1/applications/${uuid}`);
  }
  async getService(uuid: string): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(`/api/v1/services/${uuid}`);
  }

  /**
   * Clone an application into a NEW Coolify resource (same project / env /
   * server, new name). NOT deployed and NO domain on purpose — the operator
   * wires env + URL then deploys.
   *
   * The code is pinned to match the restored data:
   *  - git apps  -> git_commit_sha pinned to the snapshot's captured commit
   *  - image apps -> the exact image name:tag captured at backup time
   * Returns the new resource uuid.
   */
  async cloneApplication(opts: {
    sourceUuid: string;
    newName: string;
    projectName: string;
    environmentName: string;
    gitCommitSha?: string;
    /** Captured image reference (e.g. "org/name:v1.2.3") for docker-image apps. */
    imageRef?: string;
    /** Captured pullable digest ("org/name@sha256:…") to pin a floating tag. */
    imageDigest?: string;
  }): Promise<string> {
    const src = await this.getApplication(opts.sourceUuid);
    const serverUuid = src?.destination?.server?.uuid;
    if (!serverUuid) throw new Error("Could not resolve the source application's server for cloning");
    const projectUuid = await this.findProjectUuid(opts.projectName);
    if (!projectUuid) throw new Error(`Coolify project "${opts.projectName}" not found for cloning`);

    const base = {
      project_uuid: projectUuid,
      server_uuid: serverUuid,
      environment_name: opts.environmentName,
      name: opts.newName,
      ports_exposes: src.ports_exposes || "3000",
      instant_deploy: false,
    };

    // Docker-image app: pin the captured tag — or, when the tag is floating
    // (latest/…), the exact deployed digest — so the clone runs the same image
    // the data was backed up against, never a tag that has since moved.
    const isImageApp =
      src.build_pack === "dockerimage" || (!src.git_repository && !!src.docker_registry_image_name);
    if (isImageApp) {
      const pinned = parseImageRef(opts.imageRef);
      let imageName = pinned.name || (src.docker_registry_image_name as string | undefined);
      const imageTag = pinned.tag || (src.docker_registry_image_tag as string | undefined) || "latest";
      const floating = !pinned.tag || ["latest", "main", "master", "stable", "edge", "nightly"].includes(imageTag.toLowerCase());
      // Coolify's tag field can't hold a digest (it splits on ":"), so pin the
      // digest inside the image name ("repo/name@sha256:…") with the tag as a
      // placeholder. A concrete tag is kept as-is.
      if (floating && opts.imageDigest && opts.imageDigest.includes("@sha256:")) {
        imageName = opts.imageDigest;
      }
      const body = compact({
        ...base,
        docker_registry_image_name: imageName,
        docker_registry_image_tag: imageTag,
      });
      const created = await this.post<{ uuid?: string }>(`/api/v1/applications/dockerimage`, body);
      if (!created?.uuid) throw new Error("Coolify did not return a uuid for the cloned image application");
      return created.uuid;
    }

    if (!src.git_repository) {
      throw new Error(`Application "${src.name}" can't be "→ new" cloned (no git repo and no docker image)`);
    }
    // The create endpoints validate the body against the build pack: build-pack-
    // specific fields (dockerfile_location, etc.) are rejected ("This field is
    // not allowed") unless they match. Send only what fits.
    const bp = (src.build_pack as string | undefined) ?? "nixpacks";
    const body: Record<string, unknown> = {
      ...base,
      git_repository: src.git_repository,
      git_branch: src.git_branch,
      git_commit_sha: opts.gitCommitSha || src.git_commit_sha || "HEAD",
      build_pack: bp,
      base_directory: src.base_directory,
    };
    if (bp === "nixpacks" || bp === "static") {
      Object.assign(body, {
        install_command: src.install_command,
        build_command: src.build_command,
        start_command: src.start_command,
        publish_directory: src.publish_directory,
      });
    }
    if (bp === "static") body.static_image = src.static_image;
    if (bp === "dockerfile") body.dockerfile_location = src.dockerfile_location;
    if (bp === "dockercompose") body.docker_compose_location = src.docker_compose_location;

    // Use the create endpoint that carries over the source's auth so private /
    // self-hosted repos still resolve: a GitHub-App source, an SSH deploy key,
    // or the public endpoint (for full-URL / inline-credential repos).
    let endpoint = "/api/v1/applications/public";
    if (src.source_id != null) {
      const ghUuid = await this.resolveSourceUuid(src.source_id as number);
      if (ghUuid) {
        body.github_app_uuid = ghUuid;
        endpoint = "/api/v1/applications/private-github-app";
      }
    } else if (src.private_key_id != null) {
      const keyUuid = await this.resolvePrivateKeyUuid(src.private_key_id as number);
      if (keyUuid) {
        body.private_key_uuid = keyUuid;
        endpoint = "/api/v1/applications/private-deploy-key";
      }
    }

    const created = await this.post<{ uuid?: string }>(endpoint, compact(body));
    const uuid = created?.uuid;
    if (!uuid) throw new Error("Coolify did not return a uuid for the cloned application");

    // The /public endpoint normalises the git URL to "owner/repo" (assuming
    // github.com) and drops the real host. PATCH the exact original URL back so
    // self-hosted (gitea/gitlab) or inline-credential repos still clone.
    if (endpoint.endsWith("/public") && typeof src.git_repository === "string") {
      await this.patch(`/api/v1/applications/${uuid}`, { git_repository: src.git_repository }).catch(() => undefined);
    }
    return uuid;
  }

  /** Resolve a private SSH key's uuid from its numeric id (deploy-key clones). */
  async resolvePrivateKeyUuid(id: number): Promise<string | undefined> {
    const keys = await this.get<any[]>("/api/v1/security/keys").catch(() => []);
    return (keys ?? []).find((k) => k?.id === id)?.uuid;
  }

  /** Resolve a git source's (GitHub App) uuid from its numeric id. */
  async resolveSourceUuid(id: number): Promise<string | undefined> {
    const sources = await this.get<any[]>("/api/v1/sources").catch(() => []);
    return (sources ?? []).find((s) => s?.id === id)?.uuid;
  }

  /**
   * Clone a service into a NEW Coolify resource using its compose (or one-click
   * type). NOT deployed and NO domain — the operator wires env + URL then
   * deploys. Returns the new resource uuid.
   */
  async cloneService(opts: {
    sourceUuid: string;
    newName: string;
    projectName: string;
    environmentName: string;
  }): Promise<string> {
    const src = await this.getService(opts.sourceUuid);
    const serverUuid = src?.server?.uuid ?? src?.destination?.server?.uuid;
    if (!serverUuid) throw new Error("Could not resolve the source service's server for cloning");
    const projectUuid = await this.findProjectUuid(opts.projectName);
    if (!projectUuid) throw new Error(`Coolify project "${opts.projectName}" not found for cloning`);

    const compose = src.docker_compose_raw ?? src.docker_compose ?? src.docker_compose_yaml;
    const base = {
      project_uuid: projectUuid,
      server_uuid: serverUuid,
      environment_name: opts.environmentName,
      name: opts.newName,
      instant_deploy: false,
    };
    let body: Record<string, unknown>;
    // The /services endpoint requires docker_compose_raw to be base64-encoded.
    if (compose) body = { ...base, docker_compose_raw: Buffer.from(String(compose), "utf8").toString("base64") };
    else if (src.service_type) body = { ...base, type: src.service_type };
    else throw new Error(`Service "${src.name}" can't be cloned automatically (no compose exposed by the API)`);

    const created = await this.post<{ uuid?: string }>(`/api/v1/services`, compact(body));
    if (!created?.uuid) throw new Error("Coolify did not return a uuid for the cloned service");
    return created.uuid;
  }

  /** Best-effort copy of environment variables from one app/service to another. */
  async copyEnvVars(kind: "applications" | "services", srcUuid: string, destUuid: string): Promise<number> {
    const envs = await this.get<any[]>(`/api/v1/${kind}/${srcUuid}/envs`).catch(() => []);
    let n = 0;
    for (const e of envs ?? []) {
      if (!e?.key) continue;
      const ok = await this.post(`/api/v1/${kind}/${destUuid}/envs`, {
        key: e.key,
        value: e.value ?? "",
        is_preview: false,
        is_build_time: !!e.is_build_time,
        is_literal: !!e.is_literal,
      })
        .then(() => true)
        .catch(() => false);
      if (ok) n++;
    }
    return n;
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
