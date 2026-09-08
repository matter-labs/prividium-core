CREATE TABLE IF NOT EXISTS "siwe_messages" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" "bytea" NOT NULL,
	"user_id" text NOT NULL,
	"already_used" boolean NOT NULL,
	"msg" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_msg_address_fk" FOREIGN KEY ("address") REFERENCES "public"."wallets"("wallet_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_msg_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
