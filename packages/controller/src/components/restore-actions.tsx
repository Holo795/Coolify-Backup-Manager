"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreSnapshot } from "@/app/actions";
import { Button } from "@/components/ui";
import { RotateCcw } from "lucide-react";

/**
 * Restore (in place) and "→ new" (clone to a new Coolify resource) buttons.
 * Both need a live agent. On trigger we navigate to the snapshot's page so the
 * operator watches the restore log live (instead of a stale "queued" toast).
 */
export function RestoreActions({
  snapshotId,
  hasAgent,
  size = "sm",
}: {
  snapshotId: string;
  hasAgent: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"in_place" | "new_resource" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(target: "in_place" | "new_resource") {
    if (!hasAgent || pending) return;
    if (target === "in_place" && !window.confirm("Restore this snapshot in place? This overwrites current data.")) return;
    setError(null);
    setBusy(target);
    start(async () => {
      const r = await restoreSnapshot(snapshotId, target);
      if (r?.error) {
        setError(r.error);
        setBusy(null);
      } else {
        router.push(`/snapshots/${snapshotId}`);
      }
    });
  }

  const disabledTitle = hasAgent ? undefined : "No live agent for this instance - restore needs one";

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size={size}
        variant="outline"
        disabled={!hasAgent || pending}
        title={disabledTitle}
        onClick={() => run("in_place")}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {busy === "in_place" ? "Restoring…" : "Restore"}
      </Button>
      <Button
        size={size}
        variant="ghost"
        disabled={!hasAgent || pending}
        title={hasAgent ? "Clone to a new Coolify resource and restore into it" : disabledTitle}
        onClick={() => run("new_resource")}
      >
        {busy === "new_resource" ? "Cloning…" : "→ new"}
      </Button>
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </span>
  );
}
