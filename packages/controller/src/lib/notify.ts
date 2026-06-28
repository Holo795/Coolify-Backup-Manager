import { prisma } from "./prisma";
import { env } from "./env";

async function webhookUrl(): Promise<string | undefined> {
  const s = await prisma.setting.findUnique({ where: { id: "global" } }).catch(() => null);
  return s?.alertWebhookUrl || undefined;
}

/**
 * Post a plain message to the configured webhook. The body carries both
 * `content` (Discord) and `text` (Slack) so one URL works for either, plus most
 * custom receivers. No-op when no webhook is configured.
 */
export async function sendAlert(message: string): Promise<void> {
  const url = await webhookUrl();
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: message, text: message }),
  }).catch((e) => console.warn("[alert] webhook failed:", (e as Error).message));
}

/** Send a test message (used by the Settings page to verify the webhook). */
export async function sendTestAlert(url: string): Promise<boolean> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: "✅ CBM (Coolify Backup Manager) - test notification. Webhook is working.",
      text: "✅ CBM (Coolify Backup Manager) - test notification. Webhook is working.",
    }),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

/** Notify that backups vanished from a destination (reconciliation, best-effort).
 * Takes the snapshot ids that were just newly detected as missing. */
export async function notifyMissingBackups(snapshotIds: string[]): Promise<void> {
  if (snapshotIds.length === 0) return;
  const snaps = await prisma.snapshot
    .findMany({
      where: { id: { in: snapshotIds } },
      include: { resource: { include: { instance: true } }, destination: true },
    })
    .catch(() => []);
  if (snaps.length === 0) return;
  const base = (env.authUrl || "").replace(/\/$/, "");
  const lines = snaps
    .slice(0, 20)
    .map((s) => `• ${s.resource.name} (${s.resource.instance.name}) → ${s.destination.name}`);
  const more = snaps.length > 20 ? `\n…and ${snaps.length - 20} more` : "";
  const link = base ? `\n${base}/snapshots` : "";
  await sendAlert(
    `⚠️ Backup(s) missing from destination - files were deleted at rest:\n${lines.join("\n")}${more}${link}`,
  );
}

/** Notify that scheduled backups are overdue (never ran when expected). */
export async function notifyOverdue(
  items: { name: string; instance: string; due: Date }[],
): Promise<void> {
  if (items.length === 0) return;
  const base = (env.authUrl || "").replace(/\/$/, "");
  const lines = items.slice(0, 20).map((i) => `• ${i.name} (${i.instance}) - due ${i.due.toISOString()}`);
  const more = items.length > 20 ? `\n…and ${items.length - 20} more` : "";
  const link = base ? `\n${base}/snapshots` : "";
  await sendAlert(
    `⏰ Scheduled backup overdue - these resources have NOT been backed up on time:\n${lines.join("\n")}${more}${link}`,
  );
}

/** Notify that a backup snapshot failed (best-effort). */
export async function notifyBackupFailed(snapshotId: string): Promise<void> {
  const snap = await prisma.snapshot
    .findUnique({ where: { id: snapshotId }, include: { resource: { include: { instance: true } } } })
    .catch(() => null);
  if (!snap) return;
  const base = (env.authUrl || "").replace(/\/$/, "");
  const link = base ? `\n${base}/snapshots/${snap.id}` : "";
  await sendAlert(
    `❌ Backup failed - **${snap.resource.name}** (${snap.resource.instance.name})\n${snap.error ?? "unknown error"}${link}`,
  );
}
