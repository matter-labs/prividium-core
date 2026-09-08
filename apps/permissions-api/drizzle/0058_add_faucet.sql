CREATE TABLE "faucet_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" "bytea" NOT NULL,
	"amount_wei" numeric(78,0) NOT NULL,
	"tx_hash" "bytea",
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faucet_claims" ADD CONSTRAINT "faucet_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "faucet_claims_one_pending_per_user" ON "faucet_claims" USING btree ("user_id") WHERE "faucet_claims"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_faucet_claims_user_created" ON "faucet_claims" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_faucet_claims_status_created" ON "faucet_claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE TRIGGER audit_faucet_claims
    AFTER INSERT OR UPDATE OR DELETE ON faucet_claims
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');
--> statement-breakpoint
ALTER TABLE "faucet_claims" ADD CONSTRAINT "chk_faucet_claims_success_has_tx_hash" CHECK ("faucet_claims"."status" <> 'success' OR "faucet_claims"."tx_hash" IS NOT NULL);