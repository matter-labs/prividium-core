import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { isWellKnownDevAddress, WELL_KNOWN_DEV_ADDRESSES } from './well-known-dev-addresses';

describe('well-known dev addresses', () => {
    it('contains the canonical anvil/hardhat account 0', () => {
        expect(isWellKnownDevAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe(true);
    });

    it('contains the first anvil-zksync rich wallet', () => {
        expect(isWellKnownDevAddress('0x36615Cf349d7F6344891B1e7CA7C72883F5dc049')).toBe(true);
    });

    it('contains the first ganache deterministic account', () => {
        expect(isWellKnownDevAddress('0x627306090abaB3A6e1400e9345bC60c78a8BEf57')).toBe(true);
    });

    it('matches regardless of input casing', () => {
        expect(isWellKnownDevAddress(getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'))).toBe(true);
    });

    it('does not flag an unrelated address', () => {
        expect(isWellKnownDevAddress('0x1234567890123456789012345678901234567890')).toBe(false);
    });

    it('stores every entry in EIP-55 checksummed form', () => {
        for (const addr of WELL_KNOWN_DEV_ADDRESSES) {
            expect(addr).toBe(getAddress(addr));
        }
    });

    it('has no duplicate entries across tool groups', () => {
        const seen = new Set(WELL_KNOWN_DEV_ADDRESSES);
        expect(seen.size).toBe(WELL_KNOWN_DEV_ADDRESSES.length);
    });
});
