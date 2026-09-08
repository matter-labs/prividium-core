ALTER TABLE "wallet_transaction_allowances" RENAME COLUMN "contract_address" TO "to_address";--> statement-breakpoint

ALTER TABLE "wallet_transaction_allowances" ADD COLUMN "transaction_value" "bytea";
UPDATE "wallet_transaction_allowances" SET "transaction_value" = '\x00'::bytea WHERE "transaction_value" IS NULL;
ALTER TABLE "wallet_transaction_allowances" ALTER COLUMN "transaction_value" SET NOT NULL;
