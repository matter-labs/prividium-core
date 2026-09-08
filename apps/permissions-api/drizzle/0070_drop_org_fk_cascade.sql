-- Organizations are soft-deleted (organizations.deleted_at); rows are never hard-deleted. ON DELETE cascade on
-- these FKs is therefore dead behavior at best, and a stray hard DELETE on organizations would silently destroy
-- the related rows the soft-delete model is meant to retain. Drop the cascade and fall back to ON DELETE no action
-- so a hard delete is blocked while dependents exist (matches the oidc_providers precedent in 0066/0067).
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "m2m_applications_organizations" DROP CONSTRAINT "m2m_applications_organizations_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "org_pending_admins" DROP CONSTRAINT "org_pending_admins_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "organizations_default_roles" DROP CONSTRAINT "organizations_default_roles_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_organization_id_organizations_id_fk";
--> statement-breakpoint
-- Re-add the FKs without ON DELETE cascade. NOT VALID skips the table scan and SHARE ROW EXCLUSIVE lock that would
-- otherwise block writes; the constraints are validated in migration 0070, in a separate transaction.
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "m2m_applications_organizations" ADD CONSTRAINT "m2m_applications_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE cascade NOT VALID;--> statement-breakpoint
ALTER TABLE "org_pending_admins" ADD CONSTRAINT "org_pending_admins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE cascade NOT VALID;--> statement-breakpoint
ALTER TABLE "organizations_default_roles" ADD CONSTRAINT "organizations_default_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE cascade NOT VALID;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action NOT VALID;
