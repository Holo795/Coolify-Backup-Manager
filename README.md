# Coolify Backup Manager

A self-hostable web app to **back up and restore Coolify resources** — databases,
applications, and docker-compose services — across multiple Coolify instances.

It fills a real gap: Coolify's per-resource backups are opt-in and easy to forget,
and a raw `rsync` of `/data` misses the live database volumes entirely. This tool
gives you one panel to manage consistent backups, multiple destinations, retention,
and **fidelity-preserving restores** (including re-pinning Git deployments so the
code matches the restored data).

## Architecture

```
Controller (web panel + API + scheduler + metadata DB)
     ▲ pull (outbound HTTPS)         │ reads resources via Coolify API (×N)
   Agents (one per Docker host) ── talk to the local Docker socket
     │ push artifacts
   Destinations: local folder · SSH/SFTP · S3 (optional AES-256-GCM encryption)
```

- **Controller** — Next.js 16 (App Router) + Prisma 7 + Better Auth + an in-process
  cron scheduler. Holds metadata, encrypts secrets at rest, dispatches jobs.
- **Agent** — Node + the Docker CLI. Pulls jobs (outbound only, nothing to open on
  hosts), runs dumps/volume archives, captures Git/image provenance, transfers to
  destinations. One per Docker host.
- **`@cbm/shared`** — the zod-typed job/manifest contract shared by both.

Backup unit = a Coolify **resource**, grouped by project. A compose stack
(front + back + embedded DB) is one atomic snapshot, restored as a unit.

## Capture modes

- **cold** (default): stop the stack → `tar` the volumes → start. Bulletproof, brief downtime.
- **hot** (opt-in, databases): `pg_dump` / `mysqldump` / `mongodump` via `docker exec`,
  no downtime. DB credentials are read from the live container — never stored in the manifest.

## Policy modes

- **backup**: versioned snapshots with grandfather-father-son retention.
- **sync**: a single, overwritten copy (files + a fresh dump), no history.

## Quick start (development)

```bash
npm install
docker compose -f docker-compose.dev.yml up -d        # controller Postgres on :5544
cp packages/controller/.env.example packages/controller/.env   # edit secrets
npm run db:push --workspace @cbm/controller
npm run dev --workspace @cbm/controller                # http://localhost:3000
```

Run an agent against it:

```bash
npm run build --workspace @cbm/shared && npm run build --workspace @cbm/agent
CONTROLLER_URL=http://localhost:3000 ENROLLMENT_TOKEN=dev-enroll-token \
  node packages/agent/dist/index.js
```

## Deploying

- **Controller**: `docker compose -f docker-compose.coolify.yml up -d` (or deploy
  `Dockerfile.controller` as a Coolify application). Set `BETTER_AUTH_SECRET`,
  `MASTER_KEY`, `ENROLLMENT_TOKEN`, and a seed admin.
- **Agent** (one per Docker host):

  ```bash
  docker run -d --name cbm-agent --restart unless-stopped \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e CONTROLLER_URL=https://your-controller \
    -e ENROLLMENT_TOKEN=... \
    ghcr.io/your-org/cbm-agent:latest        # built from Dockerfile.agent
  ```

## The Git/HEAD problem

For Git-deployed apps, Coolify redeploys `HEAD`. Restoring data alone leaves the
code ahead of the data (migration drift). Each snapshot therefore records the
**deployed commit SHA + built image digest** (captured by the agent via
`docker inspect`, because the Coolify API reports `git_commit_sha = "HEAD"`). On
restore, re-pin the image/commit so the code matches the data.

## Testing

```bash
npm run test          # unit tests across all packages
# Engine smoke test against a real container:
node packages/agent/dist/cli.js run <job.json>   # see scripts in the repo
```

## Security

- Secrets (Coolify tokens, SSH/S3 creds, encryption keys) are AES-256-GCM encrypted
  at rest with a master key (`MASTER_KEY`, falling back to `BETTER_AUTH_SECRET`).
- Agents authenticate with a bearer token (sha256-hashed in the DB).
- The Docker socket grants root-equivalent access — agents run trusted on each host.
