ALTER TABLE "tenant_ip_whitelist" RENAME TO "api_keys_ip_whitelist";--> statement-breakpoint
ALTER TABLE "tenant_api_keys" RENAME TO "api_keys";--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "tenant_api_keys_keyHash_unique";--> statement-breakpoint
ALTER TABLE "api_keys_ip_whitelist" DROP CONSTRAINT "chk_api_keys_ip_whitelist_single_owner";--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "chk_api_keys_single_owner";--> statement-breakpoint
ALTER TABLE "api_keys_ip_whitelist" DROP CONSTRAINT "tenant_ip_whitelist_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys_ip_whitelist" DROP CONSTRAINT "tenant_ip_whitelist_m2m_app_id_m2m_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "tenant_api_keys_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "tenant_api_keys_m2m_app_id_m2m_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys_ip_whitelist" ADD CONSTRAINT "api_keys_ip_whitelist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_keys_ip_whitelist" ADD CONSTRAINT "api_keys_ip_whitelist_m2m_app_id_m2m_applications_id_fk" FOREIGN KEY ("m2m_app_id") REFERENCES "public"."m2m_applications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_m2m_app_id_m2m_applications_id_fk" FOREIGN KEY ("m2m_app_id") REFERENCES "public"."m2m_applications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_keyHash_unique" UNIQUE("key_hash");--> statement-breakpoint
ALTER TABLE "api_keys_ip_whitelist" ADD CONSTRAINT "chk_api_keys_ip_whitelist_single_owner" CHECK (("api_keys_ip_whitelist"."tenant_id" IS NOT NULL) <> ("api_keys_ip_whitelist"."m2m_app_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "chk_api_keys_single_owner" CHECK (("api_keys"."tenant_id" IS NOT NULL) <> ("api_keys"."m2m_app_id" IS NOT NULL));