-- Track when we last alerted that a resource's scheduled backup is overdue, so
-- the missed-backup sweep doesn't re-alert every tick for the same missed run.
ALTER TABLE "Resource" ADD COLUMN "lastOverdueAlertAt" TIMESTAMP(3);
