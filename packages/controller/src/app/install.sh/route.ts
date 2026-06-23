import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /install.sh — a tiny, idempotent installer for the backup agent.
 *
 * Usage (the per-instance token comes from the controller UI, shown once):
 *   curl -fsSL <controller>/install.sh | CBM_TOKEN=cbm_xxx sh
 *
 * It mounts the Docker socket (which Coolify's own deploy path strips, so the
 * agent must be run directly) and, if a cbm-agent container already exists on
 * the host, reconfigures it in place with the new token rather than failing on
 * a name clash.
 */
export async function GET() {
  const base = (env.agentControllerUrl || env.authUrl).replace(/\/$/, "");
  const image = `${env.agentImage}:${env.agentImageTag}`;

  const script = `#!/bin/sh
# Coolify Backup Manager — agent installer
set -e

CONTROLLER_URL="${base}"
IMAGE="${image}"
TOKEN="\${CBM_TOKEN:-\$1}"

if [ -z "\$TOKEN" ]; then
  echo "error: no enrollment token provided." >&2
  echo "usage: curl -fsSL ${base}/install.sh | CBM_TOKEN=cbm_xxx sh" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed on this host." >&2
  exit 1
fi

echo "==> Pulling \$IMAGE"
docker pull "\$IMAGE"

if docker ps -a --format '{{.Names}}' | grep -qx cbm-agent; then
  echo "==> An agent is already installed on this host — reconfiguring with the new token."
  docker rm -f cbm-agent >/dev/null 2>&1 || true
fi

echo "==> Starting cbm-agent"
docker run -d --name cbm-agent --restart unless-stopped \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v cbm-backups:/backups \\
  -e CONTROLLER_URL="\$CONTROLLER_URL" \\
  -e ENROLLMENT_TOKEN="\$TOKEN" \\
  -e AGENT_HOSTNAME="\$(hostname)" \\
  "\$IMAGE" >/dev/null

echo "==> Done. cbm-agent is running; it should appear on the controller's Agents page within ~30s."
`;

  return new Response(script, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
