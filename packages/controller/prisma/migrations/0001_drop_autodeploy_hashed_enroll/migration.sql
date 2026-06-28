-- Remove Coolify auto-deploy fields and switch the per-instance enrollment
-- token to a one-time, hash-only credential (plaintext is shown once in the UI
-- and never stored). The agent is now installed exclusively via the manual
-- `docker run` / install.sh command.

-- Drop the old plaintext token unique index + auto-deploy columns.
DROP INDEX IF EXISTS "CoolifyInstance_enrollToken_key";

ALTER TABLE "CoolifyInstance"
  DROP COLUMN IF EXISTS "enrollToken",
  DROP COLUMN IF EXISTS "agentResourceUuid",
  DROP COLUMN IF EXISTS "agentDeployStatus",
  ADD COLUMN "enrollTokenHash" TEXT,
  ADD COLUMN "enrollTokenHint" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "enrollTokenSetAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CoolifyInstance_enrollTokenHash_key" ON "CoolifyInstance"("enrollTokenHash");
