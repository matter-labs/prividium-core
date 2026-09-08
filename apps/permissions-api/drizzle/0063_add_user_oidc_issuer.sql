ALTER TABLE "users" DROP CONSTRAINT "users_oidc_sub_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "oidc_issuer" text;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE "users" ADD CONSTRAINT "uq_users_oidc_issuer_sub" UNIQUE("oidc_issuer","oidc_sub");