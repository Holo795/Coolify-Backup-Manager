# Coolify Backup Manager

A self-hostable web app to **back up and restore Coolify resources** — databases,
applications, and docker-compose services — across multiple Coolify instances, **without
ever restarting your running services**.

It fills a real gap: Coolify's per-resource backups are opt-in and easy to forget, and a
raw `rsync` of `/data` misses the live database volumes entirely. This tool gives you one
panel to manage consistent backups, multiple destinations, retention, and
fidelity-preserving restores — including recreating a resource from scratch and re-pinning
Git deployments / image tags so the code matches the restored data.

> ⚠️ **Backups are only as good as their restores.** This is young software. Always test
> that you can actually restore a snapshot before relying on it. See
> [Known limitations](#known-limitations).

Made by **[Holo795](https://github.com/Holo795)** · Licensed under **Apache-2.0**.

## Highlights

- **No restart, ever.** Standalone databases are exported live (`pg_dump`/`mysqldump`/
  `mongodump`). For everything else, the agent briefly *freezes* (`docker pause`) only the
  containers that are writing to a volume, copies it, and resumes them — the container is
  never stopped or recreated, it keeps its state and uptime.
- **Restore → new.** Recreate any resource type as a brand-new Coolify resource (the
  original is never touched): databases, git apps (commit re-pinned), docker-image apps
  (exact tag/digest), and docker-compose services (volumes re-mapped to the clone).
- **Logical exports, even inside services.** Standalone databases are dumped live; Redis/
  KeyDB/Dragonfly are snapshotted via an RDB export (no freeze); and a database living
  *inside* a docker-compose service (e.g. the Postgres in n8n) gets its own logical dump on
  top of the volume copy — application-consistent and restorable across engine versions.
- **Multiple destinations** — local folder, SSH/SFTP, or S3 — with optional AES-256-GCM
  encryption at rest.
- **Incremental & deduplicated storage (restic).** Pick the **restic** engine per destination
  (local or S3): only changed data is uploaded each run, the repository is encrypted, and
  retention is delegated to restic. Restore works in place and to a new resource.
- **Runs in parallel, with hooks.** Each agent processes several jobs at once
  (`AGENT_CONCURRENCY`), and you can set per-resource **pre/post-backup commands** (e.g. put
  an app in maintenance, flush a cache) that run inside the container.
- **Multi-server instances.** A Coolify panel can manage several servers; install one agent
  per server and each backup is routed to the agent on the resource's server automatically
  (each server gets its own schedule). Local-folder destinations are per agent — every server
  keeps its own files.
- **Destination reconciliation.** A daily check (or one click) lists each destination and
  flags any backup whose files were deleted at rest as **missing**, alerting the webhook —
  so you find out before a restore needs them.
- **Self-contained snapshots** — environment variables and host **bind mounts** are captured
  too, and a backup is verified at the destination right after upload.
- **Failure, missing & overdue-backup alerts** via a generic webhook (Discord / Slack /
  custom) — including scheduled backups that never ran (controller down, no agent on a server).
- **Scheduling** with grandfather-father-son retention, evaluated in a **configurable
  timezone** (Settings page).

## Architecture

```
Controller (web panel + API + scheduler + metadata DB)
     ▲ pull (outbound HTTPS)         │ reads resources via the Coolify API (×N instances)
   Agents (one per Docker host) ── talk to the local Docker socket
     │ push artifacts
   Destinations: local folder · SSH/SFTP · S3 (optional AES-256-GCM encryption)
```

- **Controller** — Next.js 16 (App Router) + Prisma 7 + Better Auth + an in-process cron
  scheduler. Holds metadata, encrypts secrets at rest, dispatches jobs.
- **Agent** — Node + the Docker CLI. Pulls jobs (outbound only — nothing to open on hosts),
  runs dumps / volume archives, captures Git & image provenance, transfers to destinations.
  One per Docker host.
- **`@cbm/shared`** — the zod-typed job/manifest contract shared by both.

A docker-compose stack (front + back + embedded DB) is one atomic snapshot, restored as a
unit.

## How a backup works

For each resource, the agent **never stops a container**:

1. **Standalone databases** (PostgreSQL, MySQL, MariaDB, MongoDB) → a logical dump while
   running. No freeze, no downtime, application-consistent. Credentials are read from the
   live container / Coolify API and never stored in the manifest.
2. **Redis / KeyDB / Dragonfly** → a live RDB export (no freeze), falling back to a frozen
   volume copy only if no compatible CLI is present.
3. **Apps & services** → for each volume, the agent freezes only the running containers that
   mount it **read-write**, archives the volume, and resumes them (read-only mounts and
   volumeless resources are untouched). Any database living *inside* a service additionally
   gets its own logical dump, so the restore can be application-consistent and version-portable.

The post-capture storage is chosen per destination: the **tar** engine writes one file per
artifact; the **restic** engine stores everything in an incremental, deduplicated, encrypted
repository (local or S3).

Per resource you can opt into **"live, no freeze"** — copy volumes with zero interruption,
accepting that a file rewritten exactly during the copy could be inconsistent.

## Restore

- **In place** — overwrite the resource's data (requires a brief stop for volume restores).
- **→ new** — create a fresh Coolify resource and restore into it, leaving the original
  alone. Works for databases, git apps (the captured commit is re-pinned), docker-image
  apps (the exact tag, or the deployed digest for a floating tag like `latest`), and
  compose services (volumes pre-filled under the clone's names, mounted on first deploy).

## What it backs up

| Resource | Captured |
| --- | --- |
| PostgreSQL / MySQL / MariaDB / MongoDB | logical dump (live) |
| Redis / KeyDB / Dragonfly | RDB export (live), with a frozen-volume fallback |
| Applications | named volumes + Git commit / image provenance |
| Compose services | every named volume + a logical dump of each database inside the stack |

## Known limitations

Being upfront so you don't lose data by surprise. Contributions welcome.

- **Local destinations are per agent.** A "local folder" destination is realised on each
  agent's own host, so its files are split per server (the destination page shows the
  per-server breakdown). Reconciliation, retention and restore for a local destination run on
  the agent that produced each backup — if that host is down, those operations wait for it.
  Use SSH/S3 for a single shared location reachable from any agent.
- **Server auto-detection needs a hint.** An agent figures out which Coolify server it backs
  up from the resources it can see locally; if it can't yet (a brand-new, empty host), assign
  its server by hand on the **Agents** page (or set `AGENT_SERVER_UUID`).
- **Incremental storage is restic-only, local/S3-only.** The default (tar) engine copies the
  whole volume each run. The **restic** engine deduplicates and only uploads changed data, but
  is offered for local and S3 destinations (not SSH/SFTP).
- **No automatic restore verification** — artifacts are checksummed and the destination is
  reconciled, but backups are not test-restored.
- Volume copies are **crash-consistent** (the app recovers), not application-consistent; an
  in-service database restored from its volume is version-locked to the same engine version
  (use the logical dump that's captured alongside it for a portable restore).

## Quick start (development)

```bash
npm install
docker compose -f docker-compose.dev.yml up -d        # controller Postgres on :5544
cp packages/controller/.env.example packages/controller/.env   # edit secrets
npm run db:push --workspace @cbm/controller
npm run dev --workspace @cbm/controller                # http://localhost:3000
```

Open http://localhost:3000 and create your account — the first person to register becomes
the admin, then sign-up closes. Connect a Coolify instance, then hit **Reveal install
command** on its card to get a one-time enrollment token and run an agent against it.

## Deploying

- **Controller**: `docker compose -f docker-compose.coolify.yml up -d` (or deploy
  `Dockerfile.controller` as a Coolify application). Set `BETTER_AUTH_SECRET`, `MASTER_KEY`,
  `BETTER_AUTH_URL`, and `AGENT_IMAGE` (the published agent image). The first account
  created is the admin; registration then closes.
- **Agent** (one per Docker host): in the UI, connect the instance and use **Reveal install
  command** — a one-liner that mounts the Docker socket and reconfigures in place if already
  installed:

  ```bash
  curl -fsSL https://your-controller/install.sh | CBM_TOKEN=cbm_… sh
  ```

  The agent is installed directly (not via the Coolify API), because Coolify's deploy path
  strips the Docker socket mount the agent needs.

> **Keep your `MASTER_KEY` safe.** It encrypts every stored secret and (optionally) your
> backups. If you lose it, encrypted data is unrecoverable.

## Testing

```bash
npm run test          # unit tests across the packages
```

## Security

- Secrets (Coolify tokens, SSH/S3 creds, encryption keys) are AES-256-GCM encrypted at rest
  with a master key (`MASTER_KEY`, falling back to `BETTER_AUTH_SECRET`).
- Agents authenticate with a bearer token (sha256-hashed in the DB); enrollment tokens are
  one-time and shown once.
- The Docker socket grants root-equivalent access — agents run trusted on each host.

## License

Apache License 2.0 — Copyright 2026 [Holo795](https://github.com/Holo795). See
[`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
