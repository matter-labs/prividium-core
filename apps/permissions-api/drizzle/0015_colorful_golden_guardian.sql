-- Drop `wallets` table
ALTER TABLE "siwe_messages" DROP CONSTRAINT "siwe_messages_address_wallets_wallet_address_fk";--> statement-breakpoint
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_walletAddress_unique";--> statement-breakpoint
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_wallet_address_wallets_wallet_address_fk";--> statement-breakpoint

ALTER TABLE "wallets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "wallets" CASCADE;--> statement-breakpoint

-- Update `users` table
ALTER TABLE "users" RENAME COLUMN "user_id" TO "id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "okta_sub" text;--> statement-breakpoint
UPDATE "users" SET "okta_sub" = "id";--> statement-breakpoint

ALTER TABLE "siwe_messages" DROP CONSTRAINT "siwe_messages_user_id_users_user_id_fk";--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_users_user_id_fk";--> statement-breakpoint

-- Update `user_wallets` table
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_user_id_wallet_address_pk";--> statement-breakpoint
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_user_id_users_user_id_fk";--> statement-breakpoint
ALTER TABLE "user_wallets" ADD PRIMARY KEY ("wallet_address");--> statement-breakpoint

ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_address_user_wallets_wallet_address_fk" FOREIGN KEY ("address") REFERENCES "public"."user_wallets"("wallet_address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_oktaSub_unique" UNIQUE("okta_sub");
