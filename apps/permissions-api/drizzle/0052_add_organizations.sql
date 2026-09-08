CREATE TABLE "m2m_applications_organizations" (
	"m2m_app_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m2m_applications_organizations_m2m_app_id_organization_id_pk" PRIMARY KEY("m2m_app_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organizations_default_roles" (
	"organization_id" text NOT NULL,
	"role_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_default_roles_organization_id_role_name_pk" PRIMARY KEY("organization_id","role_name")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "m2m_applications_organizations" ADD CONSTRAINT "m2m_applications_organizations_m2m_app_id_m2m_applications_id_fk" FOREIGN KEY ("m2m_app_id") REFERENCES "public"."m2m_applications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "m2m_applications_organizations" ADD CONSTRAINT "m2m_applications_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organizations_default_roles" ADD CONSTRAINT "organizations_default_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organizations_default_roles" ADD CONSTRAINT "organizations_default_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;