-- continuation from migration 0038:
-- 8) Validate constraint in a separate migration (transaction) to avoid long locks
ALTER TABLE wallet_transaction_allowances VALIDATE CONSTRAINT chk_wallet_allowance_tx_value_uint256;
