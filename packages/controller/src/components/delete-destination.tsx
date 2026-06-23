"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDestination } from "@/app/actions";
import { Button } from "@/components/ui";
import { Trash2, AlertTriangle } from "lucide-react";

/**
 * Destructive delete with a typed confirmation: deleting a destination also
 * drops every backup record stored against it, so the operator must type the
 * destination name to proceed.
 */
export function DeleteDestinationButton({
  id,
  name,
  snapshots,
  sizeLabel,
}: {
  id: string;
  name: string;
  snapshots: number;
  sizeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const ok = text.trim() === name;

  function confirm() {
    if (!ok) return;
    start(async () => {
      await deleteDestination(id);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        aria-label="Delete destination"
        onClick={() => {
          setText("");
          setOpen(true);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--color-danger)]/40 bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2 text-[var(--color-danger)]">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h3 className="font-medium">Delete destination “{name}”?</h3>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              This permanently removes the destination <b>and all {snapshots} backup{snapshots === 1 ? "" : "s"}</b>{" "}
              recorded against it ({sizeLabel}). <span className="text-foreground">This cannot be undone.</span>
            </p>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Type <span className="font-mono text-foreground">{name}</span> to confirm:
            </label>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
              placeholder={name}
              className="mb-4 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-danger)]"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" disabled={!ok || pending} onClick={confirm}>
                {pending ? "Deleting…" : "Delete destination"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
