-- continuation from migration 0045
-- validate constraint in a separate transaction to avoid long locks
-- this allows for running `SET NOT NULL` without locking the entire table

ALTER TABLE "users" VALIDATE CONSTRAINT "users_display_name_not_null";
--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_display_name_not_null";