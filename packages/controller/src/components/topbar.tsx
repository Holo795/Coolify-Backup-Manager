"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui";
import { ThemeToggle } from "./theme-toggle";

export function Topbar({ email }: { email: string }) {
  const router = useRouter();
  return (
    <header className="flex h-14 items-center justify-between border-b px-5">
      <button
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => {
          const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true });
          window.dispatchEvent(ev);
        }}
      >
        Search…
        <kbd className="rounded border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
      <div className="flex items-center gap-2">
        <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Sign out"
          onClick={async () => {
            await authClient.signOut();
            router.push("/login");
          }}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
