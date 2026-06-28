-- Group snapshots created by a single scheduled run.
ALTER TABLE "Snapshot" ADD COLUMN "runId" TEXT;
CREATE INDEX "Snapshot_runId_idx" ON "Snapshot"("runId");
