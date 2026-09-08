import { describe, expect, it } from 'vitest';
import { validatedEthereumCall } from './validate-ethereum-call';

const CALL_OBJECT = {
    from: '0x36615cf349d7f6344891b1e7ca7c72883f5dc049',
    to: '0x000000000000000000000000000000000000800a',
    data: '0x70a0823100000000000000000000000036615cf349d7f6344891b1e7ca7c72883f5dc049'
};

describe('validatedEthereumCall params schema', () => {
    const { paramsSchema } = validatedEthereumCall('eth_call', 2);

    // zod ≥4.4 makes a bare z.unknown() object key required; standard clients
    // (viem, ethers, cast) never send chainId, so it must stay optional.
    it('accepts a call object without chainId', () => {
        expect(paramsSchema.safeParse([CALL_OBJECT, 'latest']).success).toBe(true);
    });

    it('accepts and ignores a provided chainId', () => {
        expect(paramsSchema.safeParse([{ ...CALL_OBJECT, chainId: '0x129' }, 'latest']).success).toBe(true);
    });

    it('rejects unknown keys', () => {
        expect(paramsSchema.safeParse([{ ...CALL_OBJECT, bogus: 1 }, 'latest']).success).toBe(false);
    });
});
