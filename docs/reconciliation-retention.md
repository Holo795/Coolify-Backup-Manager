# Reconciliation & retention

## Reconciliation — detecting lost backups

CBM tracks your backups in its database, but the **files** live at the destination. If they're
deleted there (by mistake, a cleanup, a disk problem…), the database wouldn't know — and you'd
only find out at restore time. Reconciliation closes that gap.

- **What it does:** an agent lists the destination (or, for restic, queries the repo) and
  reports which recorded backups are still present. Any whose files are gone are flagged
  **missing** (shown in red on the snapshots and destinations pages) and an alert is sent.
- **When:** automatically **once a day**, or on demand with the **Verify** button on a
  destination (disabled when the destination has no backups yet).
- **Self-healing:** if a previously-missing backup reappears, it flips back to *succeeded*.
- **Routing:** for an SSH/S3 destination, any online agent runs the check; for a **local**
  destination, each producing agent checks its own files.

A *missing* snapshot can't be restored (the files are gone) — treat it as data loss to
investigate.

## Retention — grandfather-father-son (GFS)

Each schedule keeps a configurable number of **daily / weekly / monthly** snapshots and deletes
the rest. Retention runs after each scheduled fire (cheap, idempotent).

- **tar engine:** CBM deletes the old snapshot directories at the destination via the agent, then
  removes the database records. Empty parent directories are cleaned up too. The database record
  is only dropped once the delete was actually handed to an agent — so files aren't orphaned if
  no agent is online (it retries next run).
- **restic engine:** deletion is delegated to `restic forget --prune`, which removes the
  snapshots and frees the deduplicated data.

`sync` mode keeps a single overwritten copy instead of versioned snapshots, so retention doesn't
apply to it.

Deleting a snapshot manually (or deleting a destination) also removes its files at the
destination via the agent.
