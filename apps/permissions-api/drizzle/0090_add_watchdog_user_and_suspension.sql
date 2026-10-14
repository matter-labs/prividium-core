ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "uq_users_watchdog" ON "users" USING btree ("source") WHERE "users"."source" = 'watchdog';