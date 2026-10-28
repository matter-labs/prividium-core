CREATE TABLE "deployment_identity" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"chain_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_deployment_identity_single_row" CHECK ("deployment_identity"."id")
);--> statement-breakpoint
CREATE TRIGGER audit_deployment_identity
    AFTER INSERT OR UPDATE OR DELETE ON deployment_identity
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');
