-- Destination reconciliation: remember which agent produced each snapshot (so a
-- "local" destination's files can be re-checked / pruned / restored on the right
-- host), and record when its files were last confirmed present at the
-- destination. A snapshot whose files have vanished gets status = 'missing'.

ALTER TABLE "Snapshot" ADD COLUMN "agentId" TEXT;
ALTER TABLE "Snapshot" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);

ALTER TABLE "Snapshot"
  ADD CONSTRAINT "Snapshot_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
