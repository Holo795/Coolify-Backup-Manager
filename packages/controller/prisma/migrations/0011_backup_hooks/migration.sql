-- Optional pre/post-backup hook commands run inside the resource's primary
-- container (e.g. quiesce an app, flush a cache).
ALTER TABLE "Resource" ADD COLUMN "preBackupHook" TEXT;
ALTER TABLE "Resource" ADD COLUMN "postBackupHook" TEXT;
