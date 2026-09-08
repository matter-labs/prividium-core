CREATE TABLE IF NOT EXISTS "bytecode_disclosure_permission_roles" (
	"address" "bytea" NOT NULL,
	"role_name" text NOT NULL,
	"audience" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bytecode_disclosure_permission_roles_address_role_name_audience_pk" PRIMARY KEY("address","role_name","audience")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bytecode_disclosure_permissions" (
	"address" "bytea" NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bytecode_disclosure_permissions_address_pk" PRIMARY KEY("address")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disc_perm_roles_perm_fk" FOREIGN KEY ("address") REFERENCES "public"."bytecode_disclosure_permissions"("address") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disc_perm_roles_role_fk" FOREIGN KEY ("role_name","audience") REFERENCES "public"."roles"("role_name","audience") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
