-- Replace the single primary-container pre/post hook with per-container hooks
-- (so a multi-container service can quiesce each part). JSON array of
-- { container, pre?, post? }.
ALTER TABLE "Resource" DROP COLUMN IF EXISTS "preBackupHook";
ALTER TABLE "Resource" DROP COLUMN IF EXISTS "postBackupHook";
ALTER TABLE "Resource" ADD COLUMN "hooks" JSONB;
