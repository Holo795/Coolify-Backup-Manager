# Destinations

A **destination** is where backups are stored. Add them under **Destinations**. Each backup
schedule points at one destination; a resource can have an override pointing somewhere else.

## Types

### Local folder
Stored directly on the **agent's host** at `/backups` (bind-mounted by the install command),
so you can `ls /backups` on the host and it survives agent restarts.

> In a multi-server instance a "local" destination is **per agent** — each server keeps its own
> files. Reconciliation, retention and restore for it run on the producing agent. Use SSH/S3 for
> a single shared location. See [Multi-server](multi-server.md).

### SSH / SFTP
Reachable from any agent. Fields: host, port, username, base path, and **either** a password
**or** a private key (PEM). Optionally connect through a **jump host (bastion)** for a target
that isn't directly reachable (e.g. a private IP behind a gateway):

- the agent connects to the jump host first, then tunnels to the target;
- the jump host has its own host/port/user and key-or-password (falling back to the target's
  credentials if left blank);
- **the agent's host** must be able to reach the jump host (not your laptop).

### S3 (and S3-compatible)
Bucket, region, optional endpoint (MinIO etc.), access key, secret key, and "force path-style"
for MinIO. Reachable from any agent.

---

## Storage engines

Pick a **storage engine** per destination:

| | **tar** (default) | **restic** |
| --- | --- | --- |
| Layout | one archive/dump file per artifact | an incremental, deduplicated repository |
| Re-uploads unchanged data | every run | only what changed |
| Encryption | optional AES-256-GCM | always (native) |
| Retention | CBM deletes old snapshot files | delegated to `restic forget --prune` |
| Works on | local · SSH/SFTP · S3 | local · S3 · SSH/SFTP (incl. jump host) |

### restic
The agent bundles the `restic` binary and stores everything in a `restic-repo` under the
destination path/bucket. Only changed blocks are uploaded each run, the repo is encrypted with
a per-destination password (kept encrypted with your `MASTER_KEY`), and retention is handled by
restic. Restore works both in place and to a new resource.

Over **SSH/SFTP**, restic uses an SSH connection built by the agent (key or password, and a
jump host if configured). Password auth uses `sshpass`; the base path must already exist on the
target.

> The size shown on the destination page is the **logical** size of the artifacts, not the
> deduplicated on-disk size of the restic repo.

---

## Test & verify

- **Test** checks that the destination is reachable (for SSH it connects via the jump host too,
  and lists the base path). Note it runs from the **controller**, while backups run from the
  **agent** — their network reach can differ.
- **Verify** reconciles a destination: it confirms every recorded backup is still present (and
  flags any that vanished as *missing*). See [Reconciliation & retention](reconciliation-retention.md).

## Encryption

For the **tar** engine you can enable AES-256-GCM encryption at rest (a random key is generated
and stored encrypted with your `MASTER_KEY`). The **restic** engine encrypts natively, so the
extra layer is off for it.
