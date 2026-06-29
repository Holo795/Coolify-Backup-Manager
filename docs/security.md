# Security

## Secrets at rest

All sensitive values — Coolify API tokens, SSH/S3 credentials, tar encryption keys, and restic
repository passwords — are **AES-256-GCM encrypted at rest** with your `MASTER_KEY`
(falling back to `BETTER_AUTH_SECRET` if unset).

> **Back up your `MASTER_KEY`.** It is the root of all stored secrets and (with the restic engine)
> your backup encryption. If you lose it, encrypted data is unrecoverable. If it leaks, rotate
> credentials.

## Backup encryption

- **tar engine** — optional AES-256-GCM encryption of each artifact (a random key per
  destination, stored encrypted with `MASTER_KEY`).
- **restic engine** — the repository is always encrypted with a random per-destination password
  (also stored encrypted with `MASTER_KEY`).

## Agents & enrollment

- Agents authenticate to the controller with a **bearer token**, stored only as a sha256 hash in
  the database.
- **Enrollment tokens** (from "Reveal install command") are per-instance, shown **once**, and
  matched by hash. Revealing again rotates the token and invalidates the old one.
- Agents make **outbound** connections only (they poll the controller) — nothing needs to be
  opened on your hosts.

## Trust model

- The agent mounts the **Docker socket**, which grants root-equivalent access to its host. Run
  agents only on hosts you trust, and treat the agent image like any privileged workload.
- The controller holds the metadata DB and the master key — protect it like any admin panel
  (TLS, restricted network, strong `BETTER_AUTH_SECRET`).
- Backups can contain your application data and secrets; secure your destinations accordingly
  (encryption at rest, restricted access).

## Accounts & roles

The **first registered account is the administrator**, after which public sign-up closes. Add
OAuth providers (GitHub/Google/GitLab) if you prefer SSO — see [Configuration](configuration.md).

Additional users join by **invitation** with a role — **admin / operator / viewer**. Role
checks are enforced **server-side on every mutating action** (the UI only hides what a role
can't use, as a convenience). Invitation links are **single-use**, **expire after 48h**, are
**bound to the invited email**, and are stored only as a **sha256 hash** — the plaintext is
shown once and never persisted. The last admin can't be demoted or removed. Full details:
[Accounts & roles](accounts.md).

Email-bearing flows (password reset, verification, emailed invites) require SMTP; the SMTP
password is encrypted at rest like every other secret. See [Email](email.md).
