# Configuration

## Controller environment variables

| Variable | Required | Default | Description |
| --- | :---: | --- | --- |
| `DATABASE_URL` | ✅ (prod) | — | PostgreSQL connection string for the controller's metadata DB. |
| `BETTER_AUTH_SECRET` | ✅ | `dev-insecure…` | Long random string for session signing. Also the fallback for `MASTER_KEY`. |
| `BETTER_AUTH_URL` | ✅ | `http://localhost:3000` | The public URL the app is served at (used by auth + links in alerts). |
| `MASTER_KEY` | recommended | falls back to `BETTER_AUTH_SECRET` | Base64, 32 bytes. Encrypts all secrets at rest (and restic repo passwords). **Back this up.** |
| `AGENT_IMAGE` | — | `ghcr.io/holo795/cbm-agent` | Agent image the install command / `/install.sh` tells hosts to run. |
| `AGENT_IMAGE_TAG` | — | `latest` | Tag for the agent image. |
| `AGENT_CONTROLLER_URL` | — | falls back to `BETTER_AUTH_URL` | URL agents dial to reach the controller, if it differs from the browser URL (e.g. `http://host.docker.internal:3000` in local dev). |

Generate secrets:

```bash
openssl rand -hex 32                                                      # BETTER_AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # MASTER_KEY
```

### Optional OAuth login

Set the pair(s) you want; the provider button appears on the login page when configured.

| Provider | Variables |
| --- | --- |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitLab | `GITLAB_ISSUER`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` |

### Email (SMTP)

Optional — enables password reset, account verification, and emailed invitations. You can
also set these from **Settings → Email** in the UI; **any value set here overrides the UI and
locks that field** (config-as-code wins). Env-provided SMTP is trusted (no "send test"
needed). Full guide: **[Email (SMTP)](email.md)**.

| Variable | Default | Description |
| --- | --- | --- |
| `SMTP_HOST` | — | SMTP server hostname, e.g. `smtp.mailgun.org`. |
| `SMTP_PORT` | — | `587` (STARTTLS) or `465` (implicit TLS). |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465). |
| `SMTP_USER` / `SMTP_PASSWORD` | — | SMTP credentials. |
| `SMTP_FROM` | — | From address, e.g. `backups@yourdomain.com`. |
| `SMTP_FROM_NAME` | — | Optional display name, e.g. `CBM Backups`. |

---

## Agent environment variables

Most are set by the install command; you rarely set them by hand.

| Variable | Default | Description |
| --- | --- | --- |
| `CONTROLLER_URL` | `http://localhost:3000` | Where the agent reaches the controller. |
| `ENROLLMENT_TOKEN` | — | One-time token from "Reveal install command"; exchanged for a bearer token on first start. |
| `AGENT_TOKEN` | — | Bearer token (set automatically after enrollment). |
| `AGENT_HOSTNAME` | OS hostname | Identifies this agent (one agent per instance + hostname). |
| `AGENT_SERVER_UUID` | — | Pin this agent to a Coolify server (disables auto-detection). Usually left unset. |
| `AGENT_CONCURRENCY` | `2` | How many jobs the agent runs at once. |
| `AGENT_WORK_DIR` | `/var/lib/cbm-agent` | Local staging directory for artifacts before upload. |
| `DOCKER_BIN` | `docker` | Path to the Docker CLI. |
| `POLL_INTERVAL_MS` | `5000` | Job poll interval. |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat interval. |

The agent container must mount the Docker socket and (for "local" destinations) a persistent
`/backups` volume — the install command does both.

---

## App settings (in the UI)

- **Settings → Timezone** — IANA timezone used to evaluate schedules (cron) and display every
  timestamp. Stored server-side, the same for everyone.
- **Settings → Failure alerts** — a webhook URL (Discord / Slack / custom) notified on backup
  failures, missing backups, and overdue backups. See [Alerts](alerts.md).
