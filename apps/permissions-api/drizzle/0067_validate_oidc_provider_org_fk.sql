-- continuation from migration 0066
-- validate the re-added FK in a separate transaction so the scan does not block reads alongside
-- the NOT VALID add
ALTER TABLE "oidc_providers" VALIDATE CONSTRAINT "oidc_providers_organization_id_organizations_id_fk";
