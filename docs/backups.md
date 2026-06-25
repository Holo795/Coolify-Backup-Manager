# Backups

CBM's guiding rule: **never stop or recreate a running container.** Resources keep their state
and uptime through a backup.

## How each resource type is captured

| Resource | What CBM does |
| --- | --- |
| **PostgreSQL / MySQL / MariaDB / MongoDB** (standalone) | Logical dump while running (`pg_dump` / `mysqldump` / `mongodump`). No freeze, application-consistent. Credentials are read from the live container / Coolify API and never stored in the manifest. |
| **Redis / KeyDB / Dragonfly** | Live RDB export (`--rdb`), no freeze. Falls back to a frozen volume copy only if no compatible CLI is present. |
| **Applications** | Each named volume + Git commit / image provenance (so the code can be re-pinned to match the data on restore). |
| **Docker-compose services** | Every named volume of the stack **plus** a logical dump of each database living inside the service (e.g. the Postgres in n8n) — application-consistent and restorable across engine versions. |
| **Host bind mounts** | Data stored in host folders (RW binds) is captured too. System binds (docker socket, `/etc/*`, `/proc`, …) are skipped. |
| **Environment variables** | Captured into the snapshot (encrypted) so it can be restored even if the original resource no longer exists in Coolify. |

For volumes, the agent briefly **freezes** (`docker pause`) only the running containers that
mount the volume **read-write**, copies it, then resumes them. Read-only mounts and resources
with no volumes are never touched.

### Live mode (no freeze)
Per resource you can opt into **"live, no freeze"** — copy volumes with zero interruption,
accepting that a file rewritten exactly during the copy could be inconsistent. Useful for
resources that write a lot outside a database.

### Integrity
Each archive is streamed through `tar -tf` (it must open) before upload, and after upload the
agent confirms every artifact actually landed at the destination.

---

## Hooks (per container)

Per resource you can set **pre/post-backup commands** that run inside a container — one entry
per container, so a multi-container service can quiesce each part independently. A failing
**pre** command **aborts** the backup; the **post** command always runs afterwards (even on
failure), so it can undo the pre step.

Example: `php artisan down` (pre) / `php artisan up` (post), or flushing a cache before the copy.

---

## Scheduling & retention

Schedules are cron expressions evaluated in your configured timezone (**Settings → Timezone**).
Scope, most specific wins:

1. a **per-resource** override, else
2. a **per-server** schedule (multi-server instances), else
3. the **instance** schedule.

Each schedule has a destination, a mode, and **grandfather-father-son retention**
(keep N daily / weekly / monthly). Retention runs after each scheduled fire; for restic it is
delegated to `restic forget --prune`. See
[Reconciliation & retention](reconciliation-retention.md).

**Modes:** `backup` keeps versioned snapshots; `sync` keeps a single overwritten copy.

A resource must have **"Include in scheduled backups"** enabled to be picked up — and a schedule
must exist (enabling the toggle alone doesn't back anything up).

You can also **Back up now** from any resource, and **Back up Coolify** (the control plane's own
database + data) from the instance card.

---

## Storage

After capture, artifacts are stored via the destination's engine — one file each (**tar**) or in
an incremental, deduplicated, encrypted repository (**restic**). See [Destinations](destinations.md).
The agent runs up to `AGENT_CONCURRENCY` backups at once (default 2).
