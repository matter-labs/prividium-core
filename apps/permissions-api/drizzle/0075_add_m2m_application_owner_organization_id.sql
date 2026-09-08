ALTER TABLE "m2m_applications" ADD COLUMN "owner_organization_id" text;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "m2m_applications" ADD CONSTRAINT "m2m_applications_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_m2m_applications_owner_organization_id" ON "m2m_applications" USING btree ("owner_organization_id");