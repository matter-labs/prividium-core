CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"active_user_id" text,
	"active_tenant_id" text,
	"action_type" text NOT NULL,
	"modified_resource_id" text,
	"action_details" jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_active_user_id_users_id_fk" FOREIGN KEY ("active_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_id" ON "audit_logs" USING btree ("active_user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_id" ON "audit_logs" USING btree ("active_tenant_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action_type" ON "audit_logs" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs" USING btree ("active_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_created" ON "audit_logs" USING btree ("active_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action_created" ON "audit_logs" USING btree ("action_type","created_at");