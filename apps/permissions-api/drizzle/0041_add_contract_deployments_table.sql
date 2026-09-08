CREATE TABLE "contract_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"address" "bytea" NOT NULL,
	"deployed_by" text NOT NULL,
	"deployer_address" "bytea" NOT NULL,
	"deployer_nonce" bigint NOT NULL,
	"deploy_tx_hash" "bytea" NOT NULL,
	"started_at" timestamp with time zone,
	"success_at" timestamp with time zone,
	"errored_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_deployments" ADD CONSTRAINT "contract_deployments_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;