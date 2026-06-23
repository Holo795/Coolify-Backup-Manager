"use client";

import { useEffect, useRef, useState } from "react";

type Event = { ts: string; level: string; message: string; progress: number | null };

export function LiveLog({ snapshotId, initialStatus }: { snapshotId: string; initialStatus: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/snapshots/${snapshotId}/events`, { cache: "no-store" });
        if (res.ok && active) {
          const data = (await res.json()) as { status: string; events: Event[] };
          setEvents(data.events);
          setStatus(data.status);
          // Keep polling only while the job is still running.
          if (data.status === "running") timer = setTimeout(poll, 1500);
          return;
        }
      } catch {
        /* transient */
      }
      if (active) timer = setTimeout(poll, 3000);
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [snapshotId]);

  // Auto-scroll to the latest line.
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [events]);

  const live = status === "running";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {live ? (
          <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            live
          </span>
        ) : (
          <span>finished — {status}</span>
        )}
        <span>· {events.length} events</span>
      </div>
      <div ref={boxRef} className="max-h-80 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
        {events.length === 0 ? (
          <span className="text-muted-foreground">Waiting for the agent…</span>
        ) : (
          events.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground">{new Date(e.ts).toISOString().slice(11, 19)}</span>
              <span
                className={
                  e.level === "error"
                    ? "text-[var(--color-danger)]"
                    : e.level === "warn"
                      ? "text-[var(--color-warning)]"
                      : ""
                }
              >
                {e.message}
                {e.progress != null ? ` (${e.progress}%)` : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
