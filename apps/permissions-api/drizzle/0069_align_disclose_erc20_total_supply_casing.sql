-- Safe: we control all clients connected to the database.
-- squawk-ignore renaming-column
ALTER TABLE "contracts" RENAME COLUMN "disclose_erc_20_total_supply" TO "disclose_erc20_total_supply";