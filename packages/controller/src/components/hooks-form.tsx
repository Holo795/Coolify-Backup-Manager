"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label } from "./ui";
import { updateResourceHooks } from "@/app/actions";

type Hook = { container: string; pre?: string; post?: string };

/**
 * Per-container pre/post-backup hooks. For a multi-container resource (a
 * docker-compose service, or any resource with several containers) each
 * container gets its own row; otherwise a single "primary container" row.
 */
export function HooksForm({
  resourceId,
  containers,
  hooks,
}: {
  resourceId: string;
  containers: string[];
  hooks: Hook[];
}) {
  const existing = new Map(hooks.map((h) => [h.container, h]));
  // One row per known container, plus any container referenced by an existing
  // hook (so renamed-away hooks aren't lost). Fall back to a single primary row.
  const slots = Array.from(new Set([...containers, ...hooks.map((h) => h.container)]));
  const initial = (slots.length ? slots : [""]).map((c) => ({
    container: c,
    pre: existing.get(c)?.pre ?? "",
    post: existing.get(c)?.post ?? "",
  }));

  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const multi = slots.length > 1;

  const update = (i: number, field: "pre" | "post", val: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        start(async () => {
          await updateResourceHooks(
            resourceId,
            rows.map((r) => ({ container: r.container, pre: r.pre, post: r.post })),
          );
          setSaved(true);
        });
      }}
      className="flex flex-col gap-4"
    >
      {rows.map((r, i) => (
        <div key={r.container || "primary"} className="flex flex-col gap-2">
          {multi && (
            <div className="font-mono text-xs font-medium text-foreground">{r.container || "primary container"}</div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`pre-${i}`}>Pre-backup</Label>
              <Input
                id={`pre-${i}`}
                value={r.pre}
                onChange={(e) => update(i, "pre", e.target.value)}
                placeholder="php artisan down"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`post-${i}`}>Post-backup</Label>
              <Input
                id={`post-${i}`}
                value={r.post}
                onChange={(e) => update(i, "post", e.target.value)}
                placeholder="php artisan up"
                className="font-mono text-xs"
              />
            </div>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Run inside {multi ? "each named container" : "the resource's primary container"}. A failing pre-command aborts
        the backup; the post-command always runs. Leave blank to disable.
        {containers.length === 0 && " (Containers are detected after the first backup - for now this targets the primary container.)"}
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save hooks"}
        </Button>
        {saved && <span className="text-xs text-[var(--color-success)]">Saved ✓</span>}
      </div>
    </form>
  );
}
