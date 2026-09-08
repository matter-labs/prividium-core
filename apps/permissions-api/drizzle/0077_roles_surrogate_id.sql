-- Replace roles.role_name PK with a surrogate id, re-point every referencing table to it,
-- and de-suffix per-org admin roles ("Admin(<orgId>)" -> "Admin"), which the old global
-- name uniqueness forced. Hand-written: the auto-generated version cannot backfill.

-- 1. roles: add id and backfill. New rows get an app-generated nanoid; existing rows get a
-- nanoid-shaped id here (base64url of gen_random_uuid's random bytes) so every id has the same
-- shape. The zone admin role keeps a stable, well-known id ("admin") so operator config such as
-- SWAGGER_UI_ALLOWED_ROLES can reference it by a fixed value (see roles-repository.createOrUpdateAdminRole).
ALTER TABLE "roles" ADD COLUMN "id" text;--> statement-breakpoint
-- Suppress db-mutation audit noise from the one-time backfill below: these are schema-migration
-- writes, not user actions, and on a large environment would otherwise add one audit row per role
-- assignment. The four triggers dropped and recreated in step 7 come back enabled; the three
-- contract_* triggers are not recreated there, so they are re-enabled after the backfill.
ALTER TABLE "roles" DISABLE TRIGGER "audit_roles";--> statement-breakpoint
ALTER TABLE "user_roles" DISABLE TRIGGER "audit_user_roles";--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DISABLE TRIGGER "audit_bytecode_disclosure_permission_roles";--> statement-breakpoint
ALTER TABLE "tenants_default_roles" DISABLE TRIGGER "audit_tenants_default_roles";--> statement-breakpoint
ALTER TABLE "contract_function_permission_roles" DISABLE TRIGGER "audit_contract_function_permission_roles";--> statement-breakpoint
ALTER TABLE "contract_event_permissions_roles" DISABLE TRIGGER "audit_contract_event_permissions_roles";--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" DISABLE TRIGGER "audit_contract_template_permission_roles";--> statement-breakpoint
UPDATE "roles" SET "id" = substr(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '_-'), 1, 21);--> statement-breakpoint
UPDATE "roles" SET "id" = 'admin' WHERE "role_name" = 'admin' AND "organization_id" IS NULL;--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "roles" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint

-- 2. referencing tables: add role_id and backfill from role_name
ALTER TABLE "user_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "user_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "user_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_event_permissions_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "contract_event_permissions_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "contract_event_permissions_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_function_permission_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "contract_function_permission_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "contract_function_permission_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "contract_template_permission_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "contract_template_permission_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "bytecode_disclosure_permission_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "bytecode_disclosure_permission_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "m2m_app_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "m2m_app_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "m2m_app_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants_default_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "tenants_default_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "tenants_default_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations_default_roles" ADD COLUMN "role_id" text;--> statement-breakpoint
UPDATE "organizations_default_roles" t SET "role_id" = r."id" FROM "roles" r WHERE t."role_name" = r."role_name";--> statement-breakpoint
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "organizations_default_roles" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint

-- Re-enable the contract_* audit triggers (step 7 does not recreate them). The other four are
-- restored by their DROP/CREATE in step 7.
ALTER TABLE "contract_function_permission_roles" ENABLE TRIGGER "audit_contract_function_permission_roles";--> statement-breakpoint
ALTER TABLE "contract_event_permissions_roles" ENABLE TRIGGER "audit_contract_event_permissions_roles";--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" ENABLE TRIGGER "audit_contract_template_permission_roles";--> statement-breakpoint

-- 3. drop the old role_name foreign keys.
-- Postgres truncates constraint names at 63 chars, so two of the auto-generated names
-- differ from the full drizzle form; these are the actual names in a migrated database.
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_role_name_roles_role_name_fk";--> statement-breakpoint
ALTER TABLE "contract_event_permissions_roles" DROP CONSTRAINT "contract_event_permissions_roles_role_name_roles_role_name_fk";--> statement-breakpoint
ALTER TABLE "contract_function_permission_roles" DROP CONSTRAINT "contract_function_permission_roles_role_name";--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" DROP CONSTRAINT "contract_template_permission_roles_role_name_roles_role_name_fk";--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DROP CONSTRAINT "bytecode_disclosure_permission_roles_role_name_roles_role_name_";--> statement-breakpoint
ALTER TABLE "m2m_app_roles" DROP CONSTRAINT "m2m_app_roles_role_name_roles_role_name_fk";--> statement-breakpoint
ALTER TABLE "tenants_default_roles" DROP CONSTRAINT "tenants_default_roles_role_name_roles_role_name_fk";--> statement-breakpoint
ALTER TABLE "organizations_default_roles" DROP CONSTRAINT "organizations_default_roles_role_name_roles_role_name_fk";--> statement-breakpoint

-- 4. drop old role_name composite PKs, uniques, and indexes
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_role_name_pk";--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DROP CONSTRAINT "bytecode_disclosure_permission_roles_address_role_name_pk";--> statement-breakpoint
ALTER TABLE "m2m_app_roles" DROP CONSTRAINT "m2m_app_roles_m2m_app_id_role_name_pk";--> statement-breakpoint
ALTER TABLE "tenants_default_roles" DROP CONSTRAINT "tenants_default_roles_tenant_id_role_name_pk";--> statement-breakpoint
ALTER TABLE "organizations_default_roles" DROP CONSTRAINT "organizations_default_roles_organization_id_role_name_pk";--> statement-breakpoint
ALTER TABLE "contract_function_permission_roles" DROP CONSTRAINT "contract_function_permission_roles_unique_role";--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" DROP CONSTRAINT "template_permission_roles_unique_role";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "idx_contract_function_permission_roles_role_name";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "idx_user_roles_role_name";--> statement-breakpoint

-- 5. roles: swap the PK, name uniqueness becomes per-organization
ALTER TABLE "roles" DROP CONSTRAINT "roles_pkey";--> statement-breakpoint
-- squawk-ignore adding-serial-primary-key-field, constraint-missing-not-valid
ALTER TABLE "roles" ADD PRIMARY KEY ("id");--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE "roles" ADD CONSTRAINT "uq_roles_organization_id_role_name" UNIQUE NULLS NOT DISTINCT("organization_id","role_name");--> statement-breakpoint

-- 6. drop role_name columns and recreate PKs/uniques/indexes/FKs on role_id
-- squawk-ignore ban-drop-column
ALTER TABLE "user_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "contract_event_permissions_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "contract_function_permission_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "contract_template_permission_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "bytecode_disclosure_permission_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "m2m_app_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "tenants_default_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "organizations_default_roles" DROP COLUMN "role_name";--> statement-breakpoint
-- squawk-ignore adding-serial-primary-key-field, constraint-missing-not-valid
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id");--> statement-breakpoint
-- squawk-ignore adding-serial-primary-key-field, constraint-missing-not-valid
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disclosure_permission_roles_address_role_id_pk" PRIMARY KEY("address","role_id");--> statement-breakpoint
-- squawk-ignore adding-serial-primary-key-field, constraint-missing-not-valid
ALTER TABLE "m2m_app_roles" ADD CONSTRAINT "m2m_app_roles_m2m_app_id_role_id_pk" PRIMARY KEY("m2m_app_id","role_id");--> statement-breakpoint
-- squawk-ignore adding-serial-primary-key-field, constraint-missing-not-valid
ALTER TABLE "tenants_default_roles" ADD CONSTRAINT "tenants_default_roles_tenant_id_role_id_pk" PRIMARY KEY("tenant_id","role_id");--> statement-breakpoint
-- squawk-ignore adding-serial-primary-key-field, constraint-missing-not-valid
ALTER TABLE "organizations_default_roles" ADD CONSTRAINT "organizations_default_roles_organization_id_role_id_pk" PRIMARY KEY("organization_id","role_id");--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE "contract_function_permission_roles" ADD CONSTRAINT "contract_function_permission_roles_unique_role" UNIQUE("permission_id","role_id");--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE "contract_template_permission_roles" ADD CONSTRAINT "template_permission_roles_unique_role" UNIQUE("permission_id","role_id");--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_contract_function_permission_roles_role_id" ON "contract_function_permission_roles" USING btree ("role_id");--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "idx_user_roles_role_id" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "contract_event_permissions_roles" ADD CONSTRAINT "contract_event_permissions_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "contract_function_permission_roles" ADD CONSTRAINT "contract_function_permission_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "contract_template_permission_roles" ADD CONSTRAINT "contract_template_permission_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disclosure_permission_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "m2m_app_roles" ADD CONSTRAINT "m2m_app_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "tenants_default_roles" ADD CONSTRAINT "tenants_default_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "organizations_default_roles" ADD CONSTRAINT "organizations_default_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 7. re-point the db-mutation audit triggers whose PK argument named role_name to the new columns.
DROP TRIGGER "audit_roles" ON "roles";--> statement-breakpoint
CREATE TRIGGER audit_roles
    AFTER INSERT OR UPDATE OR DELETE ON roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint
DROP TRIGGER "audit_user_roles" ON "user_roles";--> statement-breakpoint
CREATE TRIGGER audit_user_roles
    AFTER INSERT OR UPDATE OR DELETE ON user_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:user_id,role_id');--> statement-breakpoint
DROP TRIGGER "audit_bytecode_disclosure_permission_roles" ON "bytecode_disclosure_permission_roles";--> statement-breakpoint
CREATE TRIGGER audit_bytecode_disclosure_permission_roles
    AFTER INSERT OR UPDATE OR DELETE ON bytecode_disclosure_permission_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:address,role_id');--> statement-breakpoint
DROP TRIGGER "audit_tenants_default_roles" ON "tenants_default_roles";--> statement-breakpoint
CREATE TRIGGER audit_tenants_default_roles
    AFTER INSERT OR UPDATE OR DELETE ON tenants_default_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:tenant_id,role_id');--> statement-breakpoint

-- 8. de-suffix org-admin roles now that names are only unique per organization.
-- Skips any org that already has a custom role literally named "Admin" (keeps the suffixed name there).
UPDATE "roles" r SET "role_name" = 'Admin'
WHERE r."is_system_role"
  AND r."organization_id" IS NOT NULL
  AND r."role_name" = 'Admin(' || r."organization_id" || ')'
  AND NOT EXISTS (
    SELECT 1 FROM "roles" o
    WHERE o."organization_id" = r."organization_id" AND o."role_name" = 'Admin'
  );
