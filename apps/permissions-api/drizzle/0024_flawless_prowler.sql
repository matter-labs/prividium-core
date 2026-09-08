ALTER TABLE "wallet_transaction_allowances" ADD COLUMN "transaction_calldata_bytes" bytea;

UPDATE wallet_transaction_allowances
SET "transaction_calldata_bytes" = decode(substring("transaction_calldata" from 3), 'hex')
WHERE
    "transaction_calldata" LIKE '0x%';

DELETE FROM wallet_transaction_allowances
WHERE "transaction_calldata" NOT LIKE '0x%';

ALTER TABLE "wallet_transaction_allowances" DROP COLUMN "transaction_calldata";
ALTER TABLE "wallet_transaction_allowances" RENAME COLUMN "transaction_calldata_bytes" TO "transaction_calldata";

ALTER TABLE "wallet_transaction_allowances" DROP COLUMN "hash_seen";