-- Backups no longer restart resources; the hot/cold capture mode is replaced by
-- a single "live backup" opt-out (copy without freezing, at the operator's risk).
ALTER TABLE "Resource" DROP COLUMN "captureMode";
ALTER TABLE "Resource" ADD COLUMN "liveBackup" BOOLEAN NOT NULL DEFAULT false;
