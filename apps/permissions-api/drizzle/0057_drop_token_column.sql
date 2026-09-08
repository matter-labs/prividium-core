ALTER TABLE "sessions" DROP CONSTRAINT "sessions_token_unique";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "idx_sessions_token";--> statement-breakpoint
-- Backfill token_hash for rows created before 0047 (when token_hash was added).
-- Hash matches SessionService.hashToken (sha256 hex of token).
UPDATE "sessions"
SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "token_hash" IS NULL AND "token" IS NOT NULL;--> statement-breakpoint
-- Drop any remaining sessions that have neither token nor token_hash (cannot be authenticated).
DELETE FROM "sessions" WHERE "token_hash" IS NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "sessions" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "sessions" DROP COLUMN "token";
