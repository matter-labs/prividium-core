ALTER TABLE "function_argument_restrictions" DROP CONSTRAINT "input_restriction_method_permission_fk";
--> statement-breakpoint
ALTER TABLE "balance_disclosure_lock_addresses" DROP CONSTRAINT "balance_disclosure_lock_addresses_contracts_fk";
--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" DROP CONSTRAINT "bytecode_disc_perm_roles_perm_fk";
--> statement-breakpoint
ALTER TABLE "contract_permission_roles" DROP CONSTRAINT "contract_perm_roles_perm_fk";
--> statement-breakpoint
ALTER TABLE "contract_permissions" DROP CONSTRAINT "contract_perm_contracts_fk";
--> statement-breakpoint
ALTER TABLE "siwe_messages" DROP CONSTRAINT "siwe_msg_address_fk";
--> statement-breakpoint
ALTER TABLE "siwe_messages" DROP CONSTRAINT "siwe_msg_user_fk";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_fk";
--> statement-breakpoint
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_user_fk";
--> statement-breakpoint
ALTER TABLE "user_wallets" DROP CONSTRAINT "user_wallets_wallet_fk";
--> statement-breakpoint
DROP INDEX "unique_input_restriction_per_method";--> statement-breakpoint
DROP INDEX "contract_permissions_unique_attributes";--> statement-breakpoint
DROP INDEX "user_wallets_unique_address";--> statement-breakpoint
ALTER TABLE "function_argument_restrictions" ADD CONSTRAINT "function_argument_restrictions_permission_id_contract_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_permissions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "balance_disclosure_lock_addresses" ADD CONSTRAINT "balance_disclosure_lock_addresses_contract_address_contracts_contract_address_fk" FOREIGN KEY ("contract_address") REFERENCES "public"."contracts"("contract_address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bytecode_disclosure_permission_roles" ADD CONSTRAINT "bytecode_disclosure_permission_roles_address_bytecode_disclosure_permissions_address_fk" FOREIGN KEY ("address") REFERENCES "public"."bytecode_disclosure_permissions"("address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_permission_roles" ADD CONSTRAINT "contract_permission_roles_permission_id_contract_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_permissions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_permissions" ADD CONSTRAINT "contract_permissions_contract_address_contracts_contract_address_fk" FOREIGN KEY ("contract_address") REFERENCES "public"."contracts"("contract_address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_address_wallets_wallet_address_fk" FOREIGN KEY ("address") REFERENCES "public"."wallets"("wallet_address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "siwe_messages" ADD CONSTRAINT "siwe_messages_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_wallet_address_wallets_wallet_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("wallet_address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "function_argument_restrictions" ADD CONSTRAINT "unique_input_restriction_per_method" UNIQUE("permission_id","argument_index");--> statement-breakpoint
ALTER TABLE "contract_permissions" ADD CONSTRAINT "contract_permissions_unique_attributes" UNIQUE("contract_address","method_selector","access_type");--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_walletAddress_unique" UNIQUE("wallet_address");