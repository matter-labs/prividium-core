ALTER TABLE "sessions" ADD COLUMN "renewable_until" timestamp with time zone;
-- Backfill existing rows so no live session is invalidated on upgrade.
UPDATE "sessions" SET "renewable_until" = "expires_at" WHERE "renewable_until" IS NULL;
