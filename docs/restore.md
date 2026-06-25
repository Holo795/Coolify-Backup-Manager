# Restore

From any successful snapshot you can restore **in place** or **to a new resource**.

> **A clone has no data of its own.** Coolify clones the *configuration*, not the contents — a
> freshly cloned resource starts empty. The data always comes from the snapshot (a logical dump
> loaded into the container, or a volume copy written into the resource's volume).

## In place

Overwrites the existing resource's data with the snapshot:

- **Database dumps** are loaded into the running container — **no downtime**.
- **Volumes** require a brief stop: the agent stops the containers, overwrites the volume,
  then restarts them.
- **Redis** RDB snapshots are written into the data volume and loaded on restart.
- **Service-internal databases** are additionally re-loaded from their logical dump after the
  containers are back up (best-effort, on top of the volume restore).

## → new (clone)

Creates a **brand-new Coolify resource** and restores into it — the original is never touched.
Works for all types:

- **Databases** (dump engines) — the clone is deployed and the dump is loaded into it.
- **Redis / volume databases** — the clone's (uuid-remapped) volumes are pre-filled.
- **Git applications** — the captured **commit is re-pinned** so the code matches the data.
- **Docker-image applications** — the **exact image tag** captured at backup time (a floating
  tag like `latest` is cloned as a digest-pinned service so it runs the same image).
- **Docker-compose services** — every volume is pre-filled under the clone's names, mounted on
  first deploy.

For apps and services, the clone is created **but not deployed** by default (no domain, by
design) — you review it in Coolify, then deploy. Its data is already in place. Environment
variables captured in the snapshot are applied to the clone automatically.

## With the restic engine

Restore is transparent: the agent pulls the exact snapshot from the restic repository (local,
S3, or SSH/SFTP — including a jump host), then applies it exactly like the tar engine. Both
in-place and → new are supported.

---

## ⚠️ Always test your restores

CBM checks that archives open and that backups are still present at the destination, but it does
**not** yet test-restore them automatically. Periodically do a real **→ new** restore and confirm
the resource comes up — it's the only proof that matters.
