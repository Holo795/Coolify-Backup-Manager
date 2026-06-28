-- Idempotent: pad legacy migration names recorded in _prisma_migrations to the
-- 4-digit zero-padded scheme (e.g. "3_settings" -> "0003_settings"), matching
-- the renamed migration folders. This runs once at startup BEFORE
-- `prisma migrate deploy`, so a database created before the rename keeps its
-- migrations recognised as applied (instead of being re-applied and failing).
-- No-op on a fresh DB (the table doesn't exist yet) and on already-padded names.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations') THEN
    UPDATE "_prisma_migrations"
    SET migration_name = lpad(split_part(migration_name, '_', 1), 4, '0')
                         || substring(migration_name FROM position('_' IN migration_name))
    WHERE migration_name ~ '^[0-9]+_'
      AND length(split_part(migration_name, '_', 1)) < 4;
  END IF;
END $$;
