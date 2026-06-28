-- Multi-server support: a single Coolify instance can manage several servers.
-- Capture each resource's server, let each agent know which server it backs up,
-- and allow a per-server backup schedule.

-- Resource: which Coolify server it is deployed on (from the Coolify API).
ALTER TABLE "Resource" ADD COLUMN "serverUuid" TEXT;
ALTER TABLE "Resource" ADD COLUMN "serverName" TEXT;

-- Agent: which server its Docker host backs up (auto-detected or pinned).
ALTER TABLE "Agent" ADD COLUMN "serverUuid" TEXT;
ALTER TABLE "Agent" ADD COLUMN "serverName" TEXT;
ALTER TABLE "Agent" ADD COLUMN "serverManual" BOOLEAN NOT NULL DEFAULT false;

-- BackupPolicy: optional per-server scope (with instanceId).
ALTER TABLE "BackupPolicy" ADD COLUMN "serverUuid" TEXT;
