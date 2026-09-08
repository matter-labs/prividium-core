ALTER TABLE "oidc_providers" DROP CONSTRAINT "oidc_providers_organization_id_organizations_id_fk";
--> statement-breakpoint
-- Re-add the FK without ON DELETE cascade. NOT VALID skips the table scan and SHARE ROW EXCLUSIVE
-- lock that would otherwise block writes; the constraint is validated in migration 0067, in a
-- separate transaction.
ALTER TABLE "oidc_providers" ADD CONSTRAINT "oidc_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE cascade NOT VALID;
