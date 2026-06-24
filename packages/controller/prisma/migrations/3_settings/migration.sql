-- App-wide settings (single row): timezone for schedules + timestamp display.
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);
