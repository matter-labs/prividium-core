-- Step 1: Add the id column as nullable (avoids table rewrite)
ALTER TABLE "user_wallets" ADD COLUMN "id" bigint;
--> statement-breakpoint

-- Step 2: Create a sequence for the id column
CREATE SEQUENCE "user_wallets_id_seq" AS bigint OWNED BY "user_wallets"."id";
--> statement-breakpoint

-- Step 3: Backfill existing rows with sequence values
UPDATE "user_wallets" SET "id" = nextval('user_wallets_id_seq') WHERE "id" IS NULL;
--> statement-breakpoint

-- Step 4: Set default for new rows
ALTER TABLE "user_wallets" ALTER COLUMN "id" SET DEFAULT nextval('user_wallets_id_seq');
--> statement-breakpoint

-- Step 5: Make the column NOT NULL
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "user_wallets" ALTER COLUMN "id" SET NOT NULL;
--> statement-breakpoint

-- Step 6: Add the deleted_at column
ALTER TABLE "user_wallets" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint

-- Step 7: Drop the existing primary key constraint on wallet_address
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_pkey";
--> statement-breakpoint

-- Step 8: Create unique index for the new primary key
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "user_wallets_pkey_idx" ON "user_wallets" ("id");
--> statement-breakpoint

-- Step 9: Add new primary key using the existing index (avoids table scan)
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_pkey" PRIMARY KEY USING INDEX "user_wallets_pkey_idx";
--> statement-breakpoint

-- Step 10: Add partial unique constraint to prevent duplicate active wallets
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "user_wallets_address_active_unique"
ON "user_wallets" ("wallet_address")
WHERE "deleted_at" IS NULL;
