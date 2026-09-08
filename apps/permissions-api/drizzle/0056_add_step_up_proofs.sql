CREATE TABLE "step_up_proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"proof_hash" text NOT NULL,
	"session_token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_up_proofs_proofHash_unique" UNIQUE("proof_hash")
);
ALTER TABLE "passkey_challenges" ADD COLUMN "linked_action" text;
ALTER TABLE "step_up_proofs" ADD CONSTRAINT "step_up_proofs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_step_up_proofs_user_id" ON "step_up_proofs" USING btree ("user_id");
CREATE INDEX "idx_step_up_proofs_expires_at" ON "step_up_proofs" USING btree ("expires_at");
CREATE INDEX "idx_step_up_proofs_session_token_hash" ON "step_up_proofs" USING btree ("session_token_hash");
CREATE TRIGGER audit_step_up_proofs
    AFTER INSERT OR UPDATE OR DELETE ON step_up_proofs
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'proof_hash');