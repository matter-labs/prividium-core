ALTER TABLE "rpc_permission_roles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rpc_permissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "rpc_permission_roles" CASCADE;--> statement-breakpoint
DROP TABLE "rpc_permissions" CASCADE;--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DROP CONSTRAINT "bytecode_disc_perm_roles_role_fk";
--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP CONSTRAINT "contract_perm_roles_role_fk";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_role_fk";
--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DROP CONSTRAINT "bytecode_disclosure_permission_roles_address_role_name_audience_pk";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_role_name_audience_pk";--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_role_name_audience_pk";--> statement-breakpoint
ALTER TABLE "roles" ADD PRIMARY KEY ("role_name");--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disclosure_permission_roles_address_role_name_pk" PRIMARY KEY("address","role_name");--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_role_name_pk" PRIMARY KEY("user_id","role_name");--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disclosure_permission_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_permission_roles" ADD CONSTRAINT "contract_permission_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DROP COLUMN "audience";--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP COLUMN "audience";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "audience";--> statement-breakpoint
ALTER TABLE "user_roles" DROP COLUMN "audience";