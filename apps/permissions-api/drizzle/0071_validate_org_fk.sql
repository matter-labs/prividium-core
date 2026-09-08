-- continuation from migration 0069
-- validate the re-added FKs in a separate transaction so the scan does not block reads alongside
-- the NOT VALID adds
ALTER TABLE "contracts" VALIDATE CONSTRAINT "contracts_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "m2m_applications_organizations" VALIDATE CONSTRAINT "m2m_applications_organizations_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "org_pending_admins" VALIDATE CONSTRAINT "org_pending_admins_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "organizations_default_roles" VALIDATE CONSTRAINT "organizations_default_roles_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "roles" VALIDATE CONSTRAINT "roles_organization_id_organizations_id_fk";
