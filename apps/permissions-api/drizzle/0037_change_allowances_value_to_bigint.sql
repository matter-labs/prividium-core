-- 1) Helper: convert bytea (unsigned big-endian) -> numeric
CREATE OR REPLACE FUNCTION bytea_to_numeric(b bytea) RETURNS numeric AS $$
DECLARE
    res numeric := 0;
    i integer;
    len integer;
    byt integer;
BEGIN
    IF b IS NULL THEN
        RETURN NULL;
    END IF;

    len := length(b);
    FOR i IN 0..len - 1 LOOP
            byt := get_byte(b, i);
            res := res * 256 + byt;
        END LOOP;

    RETURN res;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- 2) Add the new column with the target type (no rewrite of the existing column)
ALTER TABLE wallet_transaction_allowances ADD COLUMN transaction_value_numeric numeric(78,0);

-- 3) Backfill from the old bytea column
UPDATE wallet_transaction_allowances
    SET transaction_value_numeric = bytea_to_numeric(transaction_value)
    WHERE transaction_value IS NOT NULL;

-- 4) Add uint256 bounds check as NOT VALID, then validate
ALTER TABLE wallet_transaction_allowances DROP CONSTRAINT IF EXISTS chk_wallet_allowance_tx_value_uint256;

ALTER TABLE wallet_transaction_allowances
    ADD CONSTRAINT chk_wallet_allowance_tx_value_uint256
        CHECK (
            transaction_value_numeric >= 0
            AND transaction_value_numeric <= '115792089237316195423570985008687907853269984665640564039457584007913129639935'::numeric
        )
        NOT VALID;


-- 5) Swap columns: drop old, rename new into place
-- squawk-ignore ban-drop-column
ALTER TABLE wallet_transaction_allowances DROP COLUMN transaction_value;
-- squawk-ignore renaming-column
ALTER TABLE wallet_transaction_allowances RENAME COLUMN transaction_value_numeric TO transaction_value;

-- 6) Remove helper function (no longer needed)
DROP FUNCTION bytea_to_numeric(bytea);
