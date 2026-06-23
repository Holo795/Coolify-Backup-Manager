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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Coolify POST ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
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

  /**
   * Re-pin a Git application to a specific commit and redeploy, so the running
   * code matches restored data (avoids HEAD drift). The Coolify API stores
   * git_commit_sha = "HEAD" by default; this sets it to the captured SHA.
   */
  async repinCommit(appUuid: string, commitSha: string): Promise<void> {
    await this.patch(`/api/v1/applications/${appUuid}`, { git_commit_sha: commitSha });
    await this.get(`/api/v1/deploy?uuid=${appUuid}&force=true`);
  }

  async getCoolifyHostServerUuid(): Promise<string> {
    const servers = await this.get<any[]>("/api/v1/servers");
    const host = (servers ?? []).find((s) => s.is_coolify_host) ?? (servers ?? [])[0];
    if (!host?.uuid) throw new Error("No Coolify server found to deploy the agent on");
    return host.uuid;
  }

  /** Find or create a project, returning its uuid + first environment name. */
  async ensureProject(name: string): Promise<{ projectUuid: string; environmentName: string }> {
    const projects = await this.get<any[]>("/api/v1/projects").catch(() => []);
    let proj = (projects ?? []).find((p) => p.name === name);
    if (!proj) {
      proj = await this.post<any>("/api/v1/projects", { name, description: "Coolify Backup Manager agents" });
    }
    const detail = await this.get<any>(`/api/v1/projects/${proj.uuid}`).catch(() => null);
    const environmentName = detail?.environments?.[0]?.name ?? "production";
    return { projectUuid: proj.uuid, environmentName };
  }

  /**
   * Deploy the backup agent as a docker-image application on this instance's
   * Docker host, with the socket mounted and CONTROLLER_URL + token preset.
   * Returns the created resource uuid.
   */
  async deployAgent(opts: {
    image: string;
    tag: string;
    controllerUrl: string;
    enrollToken: string;
    existingUuid?: string;
  }): Promise<{ uuid: string }> {
    let uuid = opts.existingUuid;
    if (!uuid) {
      const { projectUuid, environmentName } = await this.ensureProject("Backup Manager");
      const serverUuid = await this.getCoolifyHostServerUuid();
      const created = await this.post<any>("/api/v1/applications/dockerimage", {
        project_uuid: projectUuid,
        server_uuid: serverUuid,
        environment_name: environmentName,
        name: "cbm-agent",
        docker_registry_image_name: opts.image,
        docker_registry_image_tag: opts.tag,
        ports_exposes: "3000",
        custom_docker_run_options: "-v /var/run/docker.sock:/var/run/docker.sock",
        instant_deploy: false,
      });
      uuid = created.uuid;
      if (!uuid) throw new Error("Coolify did not return an application uuid");

      // Inject configuration as env vars.
      const envs: Record<string, string> = {
        CONTROLLER_URL: opts.controllerUrl,
        ENROLLMENT_TOKEN: opts.enrollToken,
      };
      for (const [key, value] of Object.entries(envs)) {
        await this.post(`/api/v1/applications/${uuid}/envs`, { key, value, is_preview: false }).catch(
          () => undefined,
        );
      }
    }

    // Trigger a deploy.
    await this.get(`/api/v1/deploy?uuid=${uuid}`);
    return { uuid };
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
