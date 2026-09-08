ALTER TABLE bytecode_disclosure_permission_roles DROP CONSTRAINT bytecode_disc_perm_roles_perm_fk;
ALTER TABLE bytecode_disclosure_permission_roles DROP CONSTRAINT bytecode_disc_perm_roles_role_fk;
ALTER TABLE "bytecode_disclosure_permissions" DROP CONSTRAINT "bytecode_disclosure_permissions_address_pk";--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permissions" ADD PRIMARY KEY ("address");
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disc_perm_roles_perm_fk" FOREIGN KEY ("address") REFERENCES "public"."bytecode_disclosure_permissions"("address") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disc_perm_roles_role_fk" FOREIGN KEY ("role_name","audience") REFERENCES "public"."roles"("role_name","audience") ON DELETE cascade ON UPDATE cascade;