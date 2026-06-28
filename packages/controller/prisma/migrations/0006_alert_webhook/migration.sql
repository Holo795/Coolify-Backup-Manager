-- Optional webhook URL notified when a backup fails.
ALTER TABLE "Setting" ADD COLUMN "alertWebhookUrl" TEXT;
