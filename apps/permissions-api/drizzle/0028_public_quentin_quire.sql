ALTER TABLE "roles" ADD COLUMN "system_permissions" text[];--> statement-breakpoint
UPDATE "roles" SET "system_permissions"='{}' WHERE "role_name" <> 'admin';
UPDATE "roles" SET "system_permissions"='{"contract_deployment", "full_sequencer_rpc_access"}' WHERE "role_name"='admin';
ALTER TABLE "roles" ALTER COLUMN "system_permissions" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "roles" ADD COLUMN "is_system_role" boolean;--> statement-breakpoint
UPDATE "roles" SET "is_system_role"=false WHERE "role_name"<>'admin';
UPDATE "roles" SET "is_system_role"=true WHERE "role_name"='admin';
ALTER TABLE "roles" ALTER COLUMN "is_system_role" SET NOT NULL;
--> statement-breakpoint