"use client";

import { useState, useTransition } from "react";
import { updateResourceSettings } from "@/app/actions";
import { Check, Loader2 } from "lucide-react";

/**
 * Per-resource backup switches that save themselves on toggle (no Save button):
 *  - backupEnabled: include the resource in scheduled backups (the single gate);
 *  - liveBackup: copy volumes live without freezing (at the operator's risk).
 */
export function ResourceToggles({
  id,
  backupEnabled,
  liveBackup,
  verbose = false,
}: {
  id: string;
  backupEnabled: boolean;
  liveBackup: boolean;
  verbose?: boolean;
}) {
  const [enabled, setEnabled] = useState(backupEnabled);
  const [live, setLive] = useState(liveBackup);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function save(next: { enabled: boolean; live: boolean }) {
    const fd = new FormData();
    if (next.enabled) fd.set("backupEnabled", "on");
    if (next.live) fd.set("liveBackup", "on");
    start(async () => {
      await updateResourceSettings(id, fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  const status = pending ? (
    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
  ) : saved ? (
    <Check className="h-3 w-3 text-[var(--color-success)]" />
  ) : null;

  if (verbose) {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              save({ enabled: e.target.checked, live });
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Include in scheduled backups</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, this resource is backed up by its instance&apos;s schedule (or its own override).
              Unchecked, it&apos;s skipped by scheduled backups.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => {
              setLive(e.target.checked);
              save({ enabled, live: e.target.checked });
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Copy live, without freezing (at my own risk)</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Copies files without any freeze: zero downtime, but a file rewritten right as it&apos;s copied could be
              inconsistent. Avoid if the resource writes a lot outside its database.
            </span>
          </span>
        </label>
        <div className="h-4 text-xs text-muted-foreground">{status}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            save({ enabled: e.target.checked, live });
          }}
        />{" "}
        on
      </label>
      <label
        className="flex items-center gap-1.5 text-xs"
        title="Copy files without freezing the containers (zero downtime, but a risk of inconsistency)"
      >
        <input
          type="checkbox"
          checked={live}
          onChange={(e) => {
            setLive(e.target.checked);
            save({ enabled, live: e.target.checked });
          }}
        />{" "}
        live
      </label>
      <span className="flex h-3 w-3 items-center justify-center">{status}</span>
    </div>
  );
}
