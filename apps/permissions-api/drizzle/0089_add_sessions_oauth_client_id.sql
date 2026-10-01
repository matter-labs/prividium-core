ALTER TABLE "sessions" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
-- Migrations run in one transaction, so CONCURRENTLY is not available; the partial index covers only
-- application sessions, which do not exist yet, so the build is instant.
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_sessions_oauth_client_id" ON "sessions" USING btree ("oauth_client_id") WHERE "sessions"."oauth_client_id" IS NOT NULL;--> statement-breakpoint
-- Existing rows have neither scope 'application' nor a client id, so there is nothing to validate; NOT VALID
-- still enforces the rule on every new or updated row.
ALTER TABLE "sessions" ADD CONSTRAINT "chk_sessions_application_scope" CHECK (("sessions"."scope" IS NOT DISTINCT FROM 'application') = ("sessions"."oauth_client_id" IS NOT NULL)) NOT VALID;
