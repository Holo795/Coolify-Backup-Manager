import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { getTimezone } from "@/lib/settings";
import { TimezoneForm } from "@/components/timezone-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tz = await getTimezone();
  return (
    <>
      <PageHeader title="Settings" description="Application-wide preferences" />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <p className="text-sm text-muted-foreground">
            Used to evaluate backup schedules (cron) and to display every timestamp in the UI. Stored on the server, so
            it&apos;s the same for everyone — independent of each browser&apos;s timezone.
          </p>
        </CardHeader>
        <CardContent>
          <TimezoneForm current={tz} />
        </CardContent>
      </Card>
    </>
  );
}
