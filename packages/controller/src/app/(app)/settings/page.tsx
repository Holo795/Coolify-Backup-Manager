import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { getTimezone } from "@/lib/settings";
import { TimezoneForm } from "@/components/timezone-form";
import { AlertWebhookForm } from "@/components/alert-webhook-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tz = await getTimezone();
  const setting = await prisma.setting.findUnique({ where: { id: "global" } }).catch(() => null);

  return (
    <>
      <PageHeader title="Settings" description="Application-wide preferences" />
      <div className="flex max-w-xl flex-col gap-6">
        <Card id="timezone" className="scroll-mt-20">
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

        <Card id="alerts" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Failure alerts</CardTitle>
            <p className="text-sm text-muted-foreground">
              Get notified when a backup fails. Paste a Discord or Slack webhook URL (or any endpoint that accepts a
              JSON <code>{`{ content, text }`}</code> body). Leave blank to disable.
            </p>
          </CardHeader>
          <CardContent>
            <AlertWebhookForm current={setting?.alertWebhookUrl ?? ""} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
