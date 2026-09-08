ALTER TABLE "siwe_messages" DROP CONSTRAINT "siwe_messages_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "siwe_messages" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD COLUMN "target_type" text;

UPDATE "siwe_messages" SET "target_type"='user';
ALTER TABLE "siwe_messages"
    ALTER COLUMN "target_type" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "siwe_messages" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;