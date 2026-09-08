CREATE TABLE "siwe_challenge_log" (
	"id" text PRIMARY KEY NOT NULL,
	"address" "bytea" NOT NULL,
	"target_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siwe_consumed_nonces" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "siwe_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "passkey_challenges" DROP CONSTRAINT "passkey_challenges_linked_siwe_nonce_siwe_messages_nonce_fk";
-- squawk-ignore ban-drop-table
DROP TABLE "siwe_messages" CASCADE;--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "idx_siwe_challenge_log_address_created" ON "siwe_challenge_log" USING btree ("address","created_at");--> statement-breakpoint
CREATE INDEX "idx_siwe_consumed_nonces_consumed_at" ON "siwe_consumed_nonces" USING btree ("consumed_at");
