-- Migration: Refactor templates to use integer id as primary key
-- Keep templateKey as unique slug for API/SDK ergonomics

-- Step 1: Add id column to contract_templates with identity
ALTER TABLE "contract_templates" ADD COLUMN "id" integer GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint

-- Step 2: Add template_id column to contract_template_permissions
ALTER TABLE "contract_template_permissions" ADD COLUMN "template_id" integer;
--> statement-breakpoint

-- Step 3: Populate template_id from template_key relationship
UPDATE "contract_template_permissions" ctp
SET "template_id" = ct."id"
FROM "contract_templates" ct
WHERE ctp."template_key" = ct."template_key";
--> statement-breakpoint

-- Step 4: Add template_id column to contracts
ALTER TABLE "contracts" ADD COLUMN "template_id" integer;
--> statement-breakpoint

-- Step 5: Populate template_id from template_key relationship
UPDATE "contracts" c
SET "template_id" = ct."id"
FROM "contract_templates" ct
WHERE c."template_key" = ct."template_key";
--> statement-breakpoint

-- Step 6: Drop old foreign key constraints
ALTER TABLE "contract_template_permissions" DROP CONSTRAINT IF EXISTS "contract_template_permissions_template_key_contract_templates_template_key_fk";
--> statement-breakpoint
ALTER TABLE "contracts" DROP CONSTRAINT IF EXISTS "contracts_template_key_contract_templates_template_key_fk";
--> statement-breakpoint

-- Step 7: Drop old unique constraint on template_permissions
ALTER TABLE "contract_template_permissions" DROP CONSTRAINT IF EXISTS "template_permissions_unique_attributes";
--> statement-breakpoint

-- Step 8: Drop old index on contracts.template_key
DROP INDEX IF EXISTS "idx_contracts_template_key";
--> statement-breakpoint

-- Step 9: Drop template_key columns from referencing tables
ALTER TABLE "contract_template_permissions" DROP COLUMN "template_key";
--> statement-breakpoint
ALTER TABLE "contracts" DROP COLUMN "template_key";
--> statement-breakpoint

-- Step 10: Change primary key on contract_templates from template_key to id
ALTER TABLE "contract_templates" DROP CONSTRAINT "contract_templates_pkey";
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD PRIMARY KEY ("id");
--> statement-breakpoint

-- Step 11: Add unique constraint on template_key
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_template_key_unique" UNIQUE ("template_key");
--> statement-breakpoint

-- Step 12: Add index on template_key for lookups
CREATE INDEX "idx_contract_templates_key" ON "contract_templates" ("template_key");
--> statement-breakpoint

-- Step 13: Make template_id NOT NULL on contract_template_permissions
ALTER TABLE "contract_template_permissions" ALTER COLUMN "template_id" SET NOT NULL;
--> statement-breakpoint

-- Step 14: Add new foreign key constraints
ALTER TABLE "contract_template_permissions" ADD CONSTRAINT "contract_template_permissions_template_id_contract_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
--> statement-breakpoint

-- Step 15: Add new unique constraint on template_permissions
ALTER TABLE "contract_template_permissions" ADD CONSTRAINT "template_permissions_unique_attributes"
    UNIQUE ("template_id", "method_selector");
--> statement-breakpoint

-- Step 16: Add index on contracts.template_id
CREATE INDEX "idx_contracts_template_id" ON "contracts" ("template_id");
