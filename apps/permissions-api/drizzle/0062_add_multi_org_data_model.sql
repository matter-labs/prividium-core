CREATE TABLE "oidc_providers" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"jwks_uri" text NOT NULL,
	"audience" text NOT NULL,
	"client_id" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_providers_issuer_unique" UNIQUE("issuer")
);
--> statement-breakpoint
CREATE TABLE "org_pending_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"oidc_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_org_pending_admins_org_sub" UNIQUE("organization_id","oidc_sub")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "primary_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "oidc_providers" ADD CONSTRAINT "oidc_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "org_pending_admins" ADD CONSTRAINT "org_pending_admins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_org_pending_admins_oidc_sub" ON "org_pending_admins" USING btree ("oidc_sub");--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_audit_logs_organization_id" ON "audit_logs" USING btree ("active_organization_id");--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_contracts_organization_id" ON "contracts" USING btree ("organization_id");--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_roles_organization_id" ON "roles" USING btree ("organization_id");--> statement-breakpoint
CREATE TRIGGER audit_oidc_providers
    AFTER INSERT OR UPDATE OR DELETE ON oidc_providers
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:organization_id');--> statement-breakpoint
CREATE TRIGGER audit_org_pending_admins
    AFTER INSERT OR UPDATE OR DELETE ON org_pending_admins
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');