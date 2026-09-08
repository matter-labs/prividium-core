CREATE TABLE "m2m_app_roles" (
	"m2m_app_id" text NOT NULL,
	"role_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m2m_app_roles_m2m_app_id_role_name_pk" PRIMARY KEY("m2m_app_id","role_name")
);
--> statement-breakpoint
CREATE TABLE "m2m_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" DROP CONSTRAINT "tenant_ip_whitelist_tenant_id_ip_address_unique";--> statement-breakpoint
DROP INDEX "idx_tenant_api_keys_tenant_id";--> statement-breakpoint
DROP INDEX "idx_tenant_api_keys_key_hash";--> statement-breakpoint
DROP INDEX "idx_tenant_ip_whitelist_tenant_id";--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD COLUMN "m2m_app_id" text;--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ADD COLUMN "m2m_app_id" text;--> statement-breakpoint
ALTER TABLE "m2m_app_roles" ADD CONSTRAINT "m2m_app_roles_m2m_app_id_m2m_applications_id_fk" FOREIGN KEY ("m2m_app_id") REFERENCES "public"."m2m_applications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "m2m_app_roles" ADD CONSTRAINT "m2m_app_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles"("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_m2m_app_id_m2m_applications_id_fk" FOREIGN KEY ("m2m_app_id") REFERENCES "public"."m2m_applications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ADD CONSTRAINT "tenant_ip_whitelist_m2m_app_id_m2m_applications_id_fk" FOREIGN KEY ("m2m_app_id") REFERENCES "public"."m2m_applications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_api_keys_key_hash" ON "tenant_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_api_keys_tenant_id" ON "tenant_api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_m2m_app_id" ON "tenant_api_keys" USING btree ("m2m_app_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_ip_whitelist_tenant_id" ON "tenant_ip_whitelist" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_ip_whitelist_m2m_app_id" ON "tenant_ip_whitelist" USING btree ("m2m_app_id");--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ADD CONSTRAINT "api_keys_ip_whitelist_tenant_id_ip_address_unique" UNIQUE("tenant_id","ip_address");--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ADD CONSTRAINT "api_keys_ip_whitelist_m2m_app_id_ip_address_unique" UNIQUE("m2m_app_id","ip_address");--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "chk_api_keys_single_owner" CHECK (("tenant_api_keys"."tenant_id" IS NOT NULL) <> ("tenant_api_keys"."m2m_app_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ADD CONSTRAINT "chk_api_keys_ip_whitelist_single_owner" CHECK (("tenant_ip_whitelist"."tenant_id" IS NOT NULL) <> ("tenant_ip_whitelist"."m2m_app_id" IS NOT NULL));