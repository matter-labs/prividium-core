ALTER TABLE "function_argument_restrictions" RENAME COLUMN "input_index" TO "argument_index";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "displayName" TO "display_name";--> statement-breakpoint
DROP INDEX "unique_input_restriction_per_method";--> statement-breakpoint
CREATE UNIQUE INDEX "unique_input_restriction_per_method" ON "function_argument_restrictions" USING btree ("permission_id","argument_index");