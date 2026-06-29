# Installation

CBM has two pieces:

- **Controller** — the web panel + API + scheduler + metadata database. One per deployment.
- **Agent** — a small container on each Docker host that does the actual backups. One per host.

Both run from published images: `ghcr.io/holo795/cbm-controller` and `ghcr.io/holo795/cbm-agent`.

---

## 1. Run the controller

### Option A — Docker Compose (anywhere)

```bash
curl -fsSLO https://raw.githubusercontent.com/Holo795/CBMCoolifyBackup/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/Holo795/CBMCoolifyBackup/main/packages/controller/.env.example
mv .env.example .env
```

Edit `.env` and set at least:

```dotenv
BETTER_AUTH_URL=https://cbm.example.com        # the public URL you open in the browser
BETTER_AUTH_SECRET=<a long random string>       # openssl rand -hex 32
MASTER_KEY=<base64 32 bytes>                     # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then:

```bash
docker compose up -d
```

The controller runs database migrations automatically on start. Put it behind a reverse
proxy / TLS for production (the compose file `expose`s port 3000).

### Option B — Deploy on Coolify itself

Add this repository to Coolify as an application using `Dockerfile.controller` (or as a
docker-compose resource), attach a PostgreSQL database, and set the same environment
variables. CBM happily backs up the very Coolify it runs on.

See **[Configuration](configuration.md)** for the full variable reference.

> ⚠️ **Keep `MASTER_KEY` safe and backed up.** It encrypts every stored secret (and, with the
> restic engine, your backups). If you lose it, encrypted data is unrecoverable.

---

## 2. First run — create the admin

Open your `BETTER_AUTH_URL` and **register**. The **first account to register becomes the
administrator**, and public sign-up closes automatically afterwards. There is no seed user and
no default password.

To add teammates, invite them from **Users** with a role (admin / operator / viewer) — see
[Accounts & roles](accounts.md). For password-reset and verification emails, set up SMTP in
**Settings → Email** ([Email](email.md)).

---

## 3. Connect Coolify

In the UI: **Coolify instances → Connect**, and enter:

- the Coolify **base URL** (e.g. `https://coolify.example.com`),
- a Coolify **API token** (Coolify → Keys & Tokens → API tokens, read access is enough to
  discover resources; write access is needed for "restore → new" which creates resources).

CBM then syncs the instance and lists its resources.

---

## 4. Install an agent on each Docker host

On the instance card, click **Reveal install command** to get a one-time enrollment token,
then run the one-liner **on each host** you want to back up:

```bash
curl -fsSL https://cbm.example.com/install.sh | CBM_TOKEN=cbm_… sh
```

This starts the `cbm-agent` container with:

- the Docker socket mounted (`/var/run/docker.sock`) — required to dump/freeze/inspect,
- a persistent `/backups` volume (used by "local" destinations),
- the enrollment token, which it exchanges for a bearer token on first start.

The agent is installed **directly** (not through the Coolify API) because Coolify's deploy
path would strip the Docker socket mount the agent needs. Re-running the command reconfigures
the agent in place.

In a **multi-server** Coolify instance, run it once per server — each agent auto-detects which
Coolify server it serves. See [Multi-server](multi-server.md).

---

## 5. Configure backups

- **Destinations** → add where backups are stored (local / SSH-SFTP / S3, tar or restic).
- **Resources** → toggle "Include in scheduled backups" per resource.
- **Coolify instances** (or a resource) → set a **schedule** (cron + destination + retention).

You're done. See [Backups](backups.md) for what gets captured and how.

---

## Updating

Pull the new images and restart:

```bash
docker compose pull && docker compose up -d        # controller (migrations run on start)
```

For agents, re-run the install command on each host (it recreates the container with the
latest image), or `docker pull ghcr.io/holo795/cbm-agent:latest` then recreate `cbm-agent`.
