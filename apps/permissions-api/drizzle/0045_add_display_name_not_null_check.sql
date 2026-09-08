UPDATE "users" SET "display_name" = COALESCE("oidc_sub", "id") WHERE "display_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_not_null" CHECK ("display_name" IS NOT NULL) NOT VALID;