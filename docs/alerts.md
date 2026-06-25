# Alerts

CBM notifies you through a single **webhook** (Settings → Failure alerts) when something is
wrong. The body carries both `content` (Discord) and `text` (Slack), so one URL works for
Discord, Slack, or any custom receiver. Leave it blank to disable.

Test it with **Send test** on the Settings page.

## What triggers an alert

| Alert | When |
| --- | --- |
| **Failed** | A backup ran and failed (the agent reported an error, or the job timed out), or a scheduled run couldn't even be queued (e.g. no agent on the resource's server). |
| **Missing** | Reconciliation found a backup whose files were **deleted at the destination** — the snapshot is flagged *missing*. You learn about it before a restore needs it. |
| **Overdue** | A scheduled backup **never ran** when it should have (controller was down, no agent online, …). Detected by an hourly sweep, debounced so you're alerted once per missed run. |

Each alert names the resource and instance, and links back to the snapshot/snapshots page.

## Why three different alerts

They catch different failure modes:

- **Failed** = it ran, but broke.
- **Missing** = it succeeded, but the files later vanished from the destination.
- **Overdue** = it never ran at all.

Together they close the "I thought I had backups" gap from all three sides.
