ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_active_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_active_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_active_service_id_services_id_fk";
