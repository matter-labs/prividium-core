CREATE TABLE "tenants" (
                           "id" text PRIMARY KEY NOT NULL,
                           "name" text NOT NULL,
                           "application_id" text NOT NULL,
                           "public_key" "bytea" NOT NULL,
                           "created_at" timestamp with time zone DEFAULT now() NOT NULL,
                           "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
                           CONSTRAINT "tenants_publicKey_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"oauth_client_id" text NOT NULL,
	"oauth_redirect_uris" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_oauthClientId_unique" UNIQUE("oauth_client_id")
);
--> statement-breakpoint
CREATE TABLE "tenants_default_roles" (
	"tenant_id" text NOT NULL,
	"role_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_default_roles_tenant_id_role_name_pk" PRIMARY KEY("tenant_id","role_name")
);
--> statement-breakpoint
CREATE TABLE "tenants_users" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_users_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint

-- Before setting the new column to not null the right source has to be added to each user
ALTER TABLE "users"
    ADD COLUMN "source" text;

UPDATE "users" SET "source"='okta' WHERE "okta_sub" IS NOT NULL; -- If users have okta_sub the source is okta
UPDATE "users" SET "source"='adminPanel' WHERE "okta_sub" IS NULL; -- If users have no okta_sub the source is admin panel

ALTER TABLE users
    ALTER COLUMN source SET NOT NULL; -- We should not have any null value now, so it's safe to update to not null
--> statement-breakpoint
ALTER TABLE "tenants_default_roles" ADD CONSTRAINT "tenants_default_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenants_default_roles" ADD CONSTRAINT "tenants_default_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants_users" ADD CONSTRAINT "tenants_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenants_users" ADD CONSTRAINT "tenants_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;
