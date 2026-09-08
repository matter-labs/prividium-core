CREATE TABLE "passkey_challenges" (
	"challenge" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"challenge_type" text NOT NULL,
	"already_used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"linked_siwe_nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"device_name" text,
	"transports" text[],
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentials_credentialId_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_linked_siwe_nonce_siwe_messages_nonce_fk" FOREIGN KEY ("linked_siwe_nonce") REFERENCES "public"."siwe_messages"("nonce") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_passkey_challenges_user_id" ON "passkey_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_passkey_challenges_expires_at" ON "passkey_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_passkey_credentials_user_id" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_passkey_credentials_credential_id" ON "passkey_credentials" USING btree ("credential_id");