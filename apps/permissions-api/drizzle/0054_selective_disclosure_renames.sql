-- Safe: we control all clients connected to the database.
-- squawk-ignore renaming-table
ALTER TABLE "balance_disclosure_lock_addresses" RENAME TO "disclosed_addresses";--> statement-breakpoint

-- Safe: we control all clients connected to the database.
-- squawk-ignore renaming-column
ALTER TABLE "disclosed_addresses" RENAME COLUMN "lock_address" TO "address";--> statement-breakpoint

-- Safe: we control all clients connected to the database.
-- squawk-ignore renaming-column
ALTER TABLE "contracts" RENAME COLUMN "disclose_erc_20_balance" TO "disclose_erc_20_total_supply";--> statement-breakpoint

ALTER TABLE "disclosed_addresses" DROP CONSTRAINT "balance_disclosure_lock_addresses_contract_address_contracts_contract_address_fk";
--> statement-breakpoint
ALTER TABLE "disclosed_addresses" DROP CONSTRAINT "balance_disclosure_lock_addresses_contract_address_lock_address_pk";--> statement-breakpoint

-- Safe: disclosed_addresses table is empty in production, so the table scan and lock are instant.
-- squawk-ignore constraint-missing-not-valid, adding-serial-primary-key-field
ALTER TABLE "disclosed_addresses" ADD CONSTRAINT "disclosed_addresses_contract_address_address_pk" PRIMARY KEY("contract_address","address");--> statement-breakpoint

-- Safe: disclosed_addresses table is empty in production, so the table scan and lock are instant.
-- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
ALTER TABLE "disclosed_addresses" ADD CONSTRAINT "disclosed_addresses_contract_address_contracts_contract_address_fk" FOREIGN KEY ("contract_address") REFERENCES "public"."contracts"("contract_address") ON DELETE cascade ON UPDATE cascade;
