CREATE TABLE "contract_template_argument_restrictions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_template_argument_restrictions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"permission_id" integer,
	"argument_index" integer NOT NULL,
	CONSTRAINT "template_unique_input_restriction_per_method" UNIQUE("permission_id","argument_index")
);
--> statement-breakpoint
CREATE TABLE "contract_template_permission_roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_template_permission_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"permission_id" integer,
	"role_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_permission_roles_unique_role" UNIQUE("permission_id","role_name")
);
--> statement-breakpoint
CREATE TABLE "contract_template_permissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_template_permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"template_key" text NOT NULL,
	"method_selector" "bytea" NOT NULL,
	"access_type" text NOT NULL,
	"function_signature" text NOT NULL,
	"rule_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_permissions_unique_attributes" UNIQUE("template_key","method_selector")
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"template_key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"abi" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "contract_template_argument_restrictions" ADD CONSTRAINT "contract_template_argument_restrictions_permission_id_contract_template_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_template_permissions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" ADD CONSTRAINT "contract_template_permission_roles_permission_id_contract_template_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_template_permissions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_template_permission_roles" ADD CONSTRAINT "contract_template_permission_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_template_permissions" ADD CONSTRAINT "contract_template_permissions_template_key_contract_templates_template_key_fk" FOREIGN KEY ("template_key") REFERENCES "public"."contract_templates"("template_key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_key_contract_templates_template_key_fk" FOREIGN KEY ("template_key") REFERENCES "public"."contract_templates"("template_key") ON DELETE set null ON UPDATE cascade;