ALTER TABLE "contracts" ADD COLUMN "disclosure_start_block" bigint;
UPDATE "contracts" SET "disclosure_start_block" = 0;
--- Set this to null is safe becasue this table is really small in all production envs.
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "contracts" ALTER COLUMN "disclosure_start_block" SET NOT NULL;