CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_publicKey_unique" UNIQUE("public_key")
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "chk_sessions_user_tenant";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "active_service_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_active_service_id_services_id_fk" FOREIGN KEY ("active_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_service_id" ON "audit_logs" USING btree ("active_service_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_service_created" ON "audit_logs" USING btree ("active_service_id","created_at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "chk_sessions_owner" CHECK ("sessions"."user_id" IS NOT NULL OR "sessions"."tenant_id" IS NOT NULL OR "sessions"."service_id" IS NOT NULL);