function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  databaseUrl: optional("DATABASE_URL"),
  authSecret: optional("BETTER_AUTH_SECRET", optional("AUTH_SECRET", "dev-insecure-secret-change-me")),
  authUrl: optional("BETTER_AUTH_URL", optional("APP_URL", "http://localhost:3000")),
  // Master key (base64, 32 bytes) used to encrypt secrets at rest.
  masterKey: optional("MASTER_KEY"),
  // Agent image referenced by the manual install command + /install.sh.
  agentImage: optional("AGENT_IMAGE", "ghcr.io/holo795/cbm-agent"),
  agentImageTag: optional("AGENT_IMAGE_TAG", "latest"),
  // URL agents should reach the controller at (may differ from the browser URL,
  // e.g. host.docker.internal in local dev). Falls back to authUrl.
  agentControllerUrl: optional("AGENT_CONTROLLER_URL"),
  oauth: {
    gitlabIssuer: optional("GITLAB_ISSUER"),
    gitlabClientId: optional("GITLAB_CLIENT_ID"),
    gitlabClientSecret: optional("GITLAB_CLIENT_SECRET"),
    githubClientId: optional("GITHUB_CLIENT_ID"),
    githubClientSecret: optional("GITHUB_CLIENT_SECRET"),
    googleClientId: optional("GOOGLE_CLIENT_ID"),
    googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  },
  isProd: process.env.NODE_ENV === "production",
};

export { required, optional };
