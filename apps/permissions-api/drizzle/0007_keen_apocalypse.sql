CREATE TABLE IF NOT EXISTS "function_argument_restrictions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "function_argument_restrictions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"permission_id" integer,
	"input_index" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP CONSTRAINT "contract_perm_roles_perm_fk";
--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP CONSTRAINT "contract_permission_roles_contract_address_method_selector_role_name_audience_pk";--> statement-breakpoint
ALTER TABLE "contract_permissions" DROP CONSTRAINT "contract_permissions_contract_address_method_selector_pk";--> statement-breakpoint
ALTER TABLE "contract_permission_roles" ADD COLUMN "id" integer PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "contract_permission_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "contract_permission_roles" ADD COLUMN "permission_id" integer;--> statement-breakpoint
ALTER TABLE "contract_permissions" ADD COLUMN "id" integer PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "contract_permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "contract_permissions" ADD COLUMN "access_type" text NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "function_argument_restrictions" ADD CONSTRAINT "input_restriction_method_permission_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_permissions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_input_restriction_per_method" ON "function_argument_restrictions" USING btree ("permission_id","input_index");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_permission_roles" ADD CONSTRAINT "contract_perm_roles_perm_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_permissions"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_permissions" ADD CONSTRAINT "contract_perm_contracts_fk" FOREIGN KEY ("contract_address") REFERENCES "public"."contracts"("contract_address") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_permissions_unique_attributes" ON "contract_permissions" USING btree ("contract_address","method_selector","access_type");--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP COLUMN IF EXISTS "contract_address";--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP COLUMN IF EXISTS "method_selector";