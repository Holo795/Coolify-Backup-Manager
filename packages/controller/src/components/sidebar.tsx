"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Github } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/cn";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card/40 md:flex">
      <div className="flex h-14 items-center justify-center border-b px-5">
        <span className="text-base font-semibold tracking-wide">CBM</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <a
          href="https://github.com/Holo795/CBMCoolifyBackup"
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1.5 hover:text-foreground"
        >
          <Github className="h-3.5 w-3.5" />
          <span>
            Built by <span className="font-medium text-foreground">Holo795</span>
          </span>
        </a>
        <p className="mt-1 text-[10px]">CBM · Coolify Backup Manager · Apache-2.0</p>
      </div>
    </aside>
  );
}
