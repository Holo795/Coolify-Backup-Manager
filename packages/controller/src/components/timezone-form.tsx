"use client";

import { useEffect, useState, useTransition } from "react";
import { updateTimezone } from "@/app/actions";
import { Button, Select, Label } from "@/components/ui";

// Full IANA list when the runtime supports it, else a small fallback.
const ZONES: string[] =
  typeof (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf === "function"
    ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone")
    : ["UTC", "Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];

export function TimezoneForm({ current }: { current: string }) {
  const [tz, setTz] = useState(current);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState("");

  useEffect(() => {
    const update = () => setNow(new Date().toLocaleString("en-GB", { timeZone: tz, hour12: false }));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [tz]);

  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await updateTimezone(fd);
          setMsg(r?.error ?? "Saved ✓");
        })
      }
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">IANA timezone</Label>
        <Select id="timezone" name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} className="max-w-xs">
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Current time in this zone: <span className="tabular-nums text-foreground">{now || "…"}</span>
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </form>
  );
}
