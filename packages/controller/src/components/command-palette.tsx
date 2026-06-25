"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, HardDrive, Server, Cpu, Clock, Bell, CornerDownLeft, type LucideIcon } from "lucide-react";
import { NAV } from "./nav";

type Entry = {
  id: string;
  label: string;
  sub?: string;
  href: string;
  group: string;
  keywords?: string[];
  icon?: LucideIcon;
};

type Index = {
  resources: { id: string; name: string; type: string }[];
  destinations: { id: string; name: string; type: string }[];
  instances: { id: string; name: string }[];
  agents: { id: string; hostname: string }[];
};

// Extra search terms (incl. FR aliases) so "ressource", "tz", "webhook"… match.
const NAV_KEYWORDS: Record<string, string[]> = {
  "/": ["overview", "dashboard", "accueil", "home"],
  "/instances": ["instance", "coolify", "panel", "serveur", "server"],
  "/resources": ["resource", "ressource", "app", "application", "database", "service"],
  "/destinations": ["destination", "storage", "s3", "ssh", "local", "restic", "backup target"],
  "/snapshots": ["snapshot", "backup", "sauvegarde", "restore", "restauration"],
  "/agents": ["agent", "host", "hote"],
  "/settings": ["settings", "reglages", "réglages", "config", "configuration"],
};

// Group order in the results.
const GROUP_ORDER = ["Pages", "Settings", "Resources", "Destinations", "Instances", "Agents"];

const STATIC: Entry[] = [
  ...NAV.map((n) => ({
    id: `nav:${n.href}`,
    label: n.label,
    href: n.href,
    group: "Pages",
    keywords: NAV_KEYWORDS[n.href],
    icon: n.icon,
  })),
  {
    id: "settings:timezone",
    label: "Timezone",
    sub: "Settings",
    href: "/settings#timezone",
    group: "Settings",
    keywords: ["timezone", "time", "tz", "clock", "fuseau", "heure"],
    icon: Clock,
  },
  {
    id: "settings:alerts",
    label: "Failure alerts (webhook)",
    sub: "Settings",
    href: "/settings#alerts",
    group: "Settings",
    keywords: ["alert", "alerte", "webhook", "discord", "slack", "notification"],
    icon: Bell,
  },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<Index | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

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

  // Load the searchable entities once each time the palette opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    if (index) return;
    fetch("/api/search-index")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setIndex(d))
      .catch(() => undefined);
  }, [open, index]);

  // All entries (static + dynamic from the loaded index).
  const entries = useMemo<Entry[]>(() => {
    const dyn: Entry[] = [];
    if (index) {
      for (const r of index.resources)
        dyn.push({ id: `r:${r.id}`, label: r.name, sub: r.type, href: `/resources/${r.id}`, group: "Resources" });
      for (const d of index.destinations)
        dyn.push({ id: `d:${d.id}`, label: d.name, sub: d.type, href: `/destinations/${d.id}`, group: "Destinations", icon: HardDrive });
      for (const i of index.instances)
        dyn.push({ id: `i:${i.id}`, label: i.name, href: `/instances`, group: "Instances", icon: Server });
      for (const a of index.agents)
        dyn.push({ id: `a:${a.id}`, label: a.hostname, href: `/agents`, group: "Agents", icon: Cpu });
    }
    return [...STATIC, ...dyn];
  }, [index]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = q
      ? entries.filter((e) =>
          [e.label, e.sub ?? "", e.group, ...(e.keywords ?? [])].join(" ").toLowerCase().includes(q),
        )
      : entries.filter((e) => e.group === "Pages" || e.group === "Settings");
    return match.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)).slice(0, 50);
  }, [entries, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const go = (e: Entry) => {
    setOpen(false);
    router.push(e.href);
    const hash = e.href.split("#")[1];
    if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[active]) go(filtered[active]);
          }
        }}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page, resource, destination… (try “timezone”)"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul ref={listRef} className="max-h-80 overflow-auto p-1.5">
          {filtered.map((e, i) => {
            const prev = filtered[i - 1];
            const showGroup = !prev || prev.group !== e.group;
            const Icon = e.icon;
            return (
              <li key={e.id}>
                {showGroup && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {e.group}
                  </div>
                )}
                <button
                  data-i={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(e)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
                    i === active ? "bg-muted" : "hover:bg-muted/60"
                  }`}
                >
                  {Icon ? (
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">{e.label}</span>
                  {e.sub && <span className="shrink-0 text-xs text-muted-foreground">{e.sub}</span>}
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results</li>
          )}
        </ul>
      </div>
    </div>
  );
}
