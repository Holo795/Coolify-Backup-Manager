"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { NAV } from "./nav";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const items = NAV.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul className="max-h-72 overflow-auto p-1.5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <button
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {item.label}
                </button>
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results</li>
          )}
        </ul>
      </div>
    </div>
  );
}
