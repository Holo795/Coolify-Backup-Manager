"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Select } from "./ui";

type Dest = { id: string; name: string };
type Defaults = {
  frequency?: string;
  customCron?: string;
  destinationId?: string;
  mode?: string;
  retentionDaily?: number;
  retentionWeekly?: number;
  retentionMonthly?: number;
};

export function ScheduleForm({
  action,
  destinations,
  defaults,
  submitLabel = "Save schedule",
}: {
  action: (fd: FormData) => Promise<{ ok?: boolean; error?: string } | void>;
  destinations: Dest[];
  defaults?: Defaults;
  submitLabel?: string;
}) {
  const [frequency, setFrequency] = useState(defaults?.frequency ?? "daily");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (destinations.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a destination first (Destinations page).</p>;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await action(fd);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="frequency">Frequency</Label>
          <Select id="frequency" name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily (02:00)</option>
            <option value="weekly">Weekly (Mon)</option>
            <option value="monthly">Monthly (1st)</option>
            <option value="custom">Custom cron…</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mode">Mode</Label>
          <Select id="mode" name="mode" defaultValue={defaults?.mode ?? "backup"}>
            <option value="backup">backup (versioned)</option>
            <option value="sync">sync (single copy)</option>
          </Select>
        </div>
      </div>

      {frequency === "custom" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customCron">Cron expression</Label>
          <Input id="customCron" name="customCron" defaultValue={defaults?.customCron ?? "0 2 * * *"} className="font-mono" />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destinationId">Destination</Label>
        <Select id="destinationId" name="destinationId" defaultValue={defaults?.destinationId} required>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Ret name="retentionDaily" label="Keep daily" def={defaults?.retentionDaily ?? 7} />
        <Ret name="retentionWeekly" label="Keep weekly" def={defaults?.retentionWeekly ?? 4} />
        <Ret name="retentionMonthly" label="Keep monthly" def={defaults?.retentionMonthly ?? 6} />
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

function Ret({ name, label, def }: { name: string; label: string; def: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={0} defaultValue={def} />
    </div>
  );
}
