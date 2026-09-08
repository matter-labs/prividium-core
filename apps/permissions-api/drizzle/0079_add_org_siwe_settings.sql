ALTER TABLE "organizations" ADD COLUMN "siwe_login_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "siwe_allowed_domains" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- The organizations table was created (0052) without a mutation-audit trigger; the SIWE domain
-- allowlist added here is security-relevant, so close that gap now.
CREATE TRIGGER audit_organizations
    AFTER INSERT OR UPDATE OR DELETE ON organizations
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');