CREATE TABLE "rpc_denials" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"rpc_method" text NOT NULL,
	"tx_hash" "bytea",
	"target_address" "bytea",
	"actor_type" text NOT NULL,
	"actor_id" text,
	"organization_id" text,
	"ip" text,
	"reason" text,
	"rule_id" text,
	"request_id" text,
	"trace_id" text,
	"count" bigint DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tx_hash" "bytea" NOT NULL,
	"sender_address" "bytea" NOT NULL,
	"nonce" bigint NOT NULL,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_rpc_denials_created_at" ON "rpc_denials" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_rpc_denials_last_seen_at" ON "rpc_denials" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_rpc_denials_tx_hash" ON "rpc_denials" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_rpc_denials_dedupe_key" ON "rpc_denials" USING btree ("origin","actor_type","actor_id","rpc_method","target_address","rule_id") WHERE tx_hash is null;--> statement-breakpoint
CREATE INDEX "idx_submission_receipts_created_at" ON "submission_receipts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_submission_receipts_tx_hash" ON "submission_receipts" USING btree ("tx_hash");