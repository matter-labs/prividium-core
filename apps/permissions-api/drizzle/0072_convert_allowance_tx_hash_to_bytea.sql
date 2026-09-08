-- Convert wallet_transaction_allowances.transaction_hash from text to bytea.
-- Stored values are always a 0x-prefixed keccak256 hash (even-length hex) or NULL,
-- so `decode(substring(... from 3), 'hex')` is a lossless conversion. decode(NULL) is NULL.
-- Safe: we control all clients connected to the database, and the rewrite lock is acceptable here.
ALTER TABLE "wallet_transaction_allowances"
  -- squawk-ignore changing-column-type
  ALTER COLUMN "transaction_hash" SET DATA TYPE bytea
  USING decode(substring("transaction_hash" from 3), 'hex');
