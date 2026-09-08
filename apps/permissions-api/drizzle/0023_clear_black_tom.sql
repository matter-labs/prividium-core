ALTER TABLE "users" RENAME COLUMN "okta_sub" TO "oidc_sub";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_oktaSub_unique";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_oidc_sub_unique" UNIQUE("oidc_sub");

-- Update user source values from 'okta' to 'oidc'
UPDATE "users" SET "source" = 'oidc' WHERE "source" = 'okta';

-- Update audit_logs action types from 'user.create-from-okta' to 'user.create-from-oidc'
UPDATE "audit_logs" SET "action_type" = 'user.create-from-oidc' WHERE "action_type" = 'user.create-from-okta';