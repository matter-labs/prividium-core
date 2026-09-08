-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "idx_rpc_denials_tx_hash";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "idx_submission_receipts_tx_hash";--> statement-breakpoint
ALTER TABLE "submission_receipts" ADD COLUMN "outcome" text DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_receipts" ADD COLUMN "rejection_code" bigint;--> statement-breakpoint
ALTER TABLE "submission_receipts" ADD COLUMN "count" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_receipts" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DELETE FROM "rpc_denials" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "tx_hash" ORDER BY "last_seen_at" DESC, "id" DESC) AS rn
		FROM "rpc_denials" WHERE "tx_hash" IS NOT NULL
	) t WHERE t.rn > 1
);--> statement-breakpoint
DELETE FROM "submission_receipts" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "tx_hash" ORDER BY "last_seen_at" DESC, "id" DESC) AS rn
		FROM "submission_receipts"
	) t WHERE t.rn > 1
);--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "uq_rpc_denials_tx_hash" ON "rpc_denials" USING btree ("tx_hash") WHERE tx_hash is not null;--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "uq_submission_receipts_tx_hash" ON "submission_receipts" USING btree ("tx_hash");
