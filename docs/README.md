# CBM Documentation

Detailed docs for **CBM — Coolify Backup Manager**. New here? Start with the
[project README](../README.md), then come back for the details.

- **[Installation](installation.md)** — run the controller, install agents, deploy on Coolify
- **[Configuration](configuration.md)** — every environment variable (controller & agent)
- **[Destinations](destinations.md)** — local · SSH/SFTP · jump host · S3 · tar vs restic engine
- **[Backups](backups.md)** — how each resource type is captured, hooks, live mode, scheduling
- **[Restore](restore.md)** — in place vs → new (clone)
- **[Multi-server](multi-server.md)** — one agent per server, routing, per-server schedules
- **[Alerts](alerts.md)** — failed / missing / overdue webhooks
- **[Reconciliation & retention](reconciliation-retention.md)** — detect lost backups, GFS retention
- **[Security](security.md)** — encryption at rest, tokens, the trust model
- **[Troubleshooting / FAQ](troubleshooting.md)**

> Docs live in this folder and are versioned with the code — please update them
> alongside any change (see [CONTRIBUTING](../CONTRIBUTING.md)).
