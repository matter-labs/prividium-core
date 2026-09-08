CREATE TABLE "wallet_transaction_allowances" (
	"user_id" text NOT NULL,
	"wallet_address" "bytea" NOT NULL,
	"contract_address" "bytea" NOT NULL,
	"transaction_nonce" integer NOT NULL,
	"transaction_calldata" text NOT NULL,
	"transaction_hash" text,
	"hash_seen" boolean DEFAULT false NOT NULL,
	"active_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transaction_allowances_user_id_wallet_address_transaction_nonce_pk" PRIMARY KEY("user_id","wallet_address","transaction_nonce")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_token" text;--> statement-breakpoint
ALTER TABLE "wallet_transaction_allowances" ADD CONSTRAINT "wallet_transaction_allowances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;