-- restic storage engine: per-destination incremental/deduplicated repository.
ALTER TABLE "Destination" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'tar';
ALTER TABLE "Destination" ADD COLUMN "resticPasswordEnc" TEXT;

-- restic snapshot id for each snapshot stored via the restic engine.
ALTER TABLE "Snapshot" ADD COLUMN "resticSnapshotId" TEXT;
