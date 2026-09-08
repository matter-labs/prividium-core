-- Phase 1: introduce hashed session tokens while keeping plaintext token
-- for compatibility during dual-write rollout. Cleanup/drop follows in phase 2.
ALTER TABLE "sessions" ADD COLUMN "token_hash" text;--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "idx_sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
-- squawk-ignore ban-drop-not-null
ALTER TABLE "sessions" ALTER COLUMN "token" DROP NOT NULL;
