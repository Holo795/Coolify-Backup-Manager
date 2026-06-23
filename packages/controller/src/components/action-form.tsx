"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "./ui";

type ActionResult = { ok?: boolean; error?: string; warning?: string } | void;

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  resetOnSuccess = true,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel?: string;
  resetOnSuccess?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setWarning(null);
        start(async () => {
          const r = await action(fd);
          if (r && "error" in r && r.error) setError(r.error);
          else {
            if (r && "warning" in r && r.warning) setWarning(r.warning);
            if (resetOnSuccess) formRef.current?.reset();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      {children}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {warning && <p className="text-sm text-[var(--color-warning)]">{warning}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}
