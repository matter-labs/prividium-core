import { z } from 'zod/v4';

export const bigintStringSchema = z.string().refine((v) => {
    try {
        if (!/^[0-9]+$/.test(v)) {
            return false;
        }

        BigInt(v);
        return true;
    } catch {
        return false;
    }
});
const MAX_UINT256 = (1n << 256n) - 1n;

export const bigintUint256NumericSchema = z.coerce.bigint().min(0n).max(MAX_UINT256);
