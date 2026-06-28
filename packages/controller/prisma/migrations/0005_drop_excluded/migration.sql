-- backupEnabled is now the single gate for scheduled backups; "excluded" is gone.
ALTER TABLE "Resource" DROP COLUMN "excluded";
