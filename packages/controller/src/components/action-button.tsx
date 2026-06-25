"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "./ui";

type Result = { ok?: boolean; error?: string; detail?: string } | void;

export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  successMsg = "Done",
  disabled = false,
  title,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "icon";
  confirm?: string;
  successMsg?: string;
  /** Disable the button (e.g. nothing to act on); `title` explains why on hover. */
  disabled?: boolean;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        title={title}
        disabled={pending || disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setMsg(null);
          start(async () => {
            const r = await action();
            if (r && "error" in r && r.error) setMsg({ ok: false, text: r.error });
            else setMsg({ ok: true, text: (r && "detail" in r && r.detail) || successMsg });
            setTimeout(() => setMsg(null), 6000);
          });
        }}
      >
        {pending ? "…" : children}
      </Button>
      {msg && (
        <span className={`text-xs ${msg.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
