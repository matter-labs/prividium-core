import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../utils/error-types';
import { createWalletAssociationGuard } from './wallet-association-guard';

const ANVIL_ACCOUNT_0 = getAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
const ANVIL_ACCOUNT_9 = getAddress('0xa0Ee7A142d267C1f36714E4a8F75612F20a79720');
const RANDOM_EOA = getAddress('0x1234567890123456789012345678901234567890');

describe('createWalletAssociationGuard', () => {
    it('rejects a well-known dev address with no allowlist', () => {
        const guard = createWalletAssociationGuard([]);
        expect(() => guard([ANVIL_ACCOUNT_0])).toThrow(InvalidInputError);
    });

    it('rejects a well-known dev address not on the allowlist', () => {
        const guard = createWalletAssociationGuard([ANVIL_ACCOUNT_9]);
        expect(() => guard([ANVIL_ACCOUNT_0])).toThrow(InvalidInputError);
    });

    it('rejects when any address in the batch is a non-allowlisted dev address', () => {
        const guard = createWalletAssociationGuard([]);
        expect(() => guard([RANDOM_EOA, ANVIL_ACCOUNT_0])).toThrow(InvalidInputError);
    });

    it('allows a well-known dev address that is on the allowlist', () => {
        const guard = createWalletAssociationGuard([ANVIL_ACCOUNT_0]);
        expect(() => guard([ANVIL_ACCOUNT_0])).not.toThrow();
    });

    it('matches allowlist entries irrespective of checksum casing', () => {
        const guard = createWalletAssociationGuard([getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')]);
        expect(() => guard([ANVIL_ACCOUNT_0])).not.toThrow();
    });

    it('allows any address that is not on the well-known list', () => {
        const guard = createWalletAssociationGuard([]);
        expect(() => guard([RANDOM_EOA])).not.toThrow();
    });

    it('allows an empty batch', () => {
        const guard = createWalletAssociationGuard([]);
        expect(() => guard([])).not.toThrow();
    });

    it('uses a generic message that does not leak the dev tool family', () => {
        const guard = createWalletAssociationGuard([]);
        try {
            guard([ANVIL_ACCOUNT_0]);
            throw new Error('expected guard to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(InvalidInputError);
            expect((err as Error).message).not.toMatch(/anvil/i);
            expect((err as Error).message).not.toMatch(/foundry/i);
            expect((err as Error).message).not.toMatch(/hardhat/i);
        }
    });
});
