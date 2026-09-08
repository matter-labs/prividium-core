CREATE TABLE IF NOT EXISTS "balance_disclosure_lock_addresses" (
	"contract_address" "bytea" NOT NULL,
	"lock_address" "bytea" NOT NULL,
	CONSTRAINT "balance_disclosure_lock_addresses_contract_address_lock_address_pk" PRIMARY KEY("contract_address","lock_address")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "disclose_erc_20_balance" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_disclosure_lock_addresses" ADD CONSTRAINT "balance_disclosure_lock_addresses_contracts_fk" FOREIGN KEY ("contract_address") REFERENCES "public"."contracts"("contract_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
