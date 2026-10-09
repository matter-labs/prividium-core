import type { Address, Hex, PublicClient } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { ERC1271Verifier } from './erc1271-verifier';

const SIGNER: Address = '0x1111111111111111111111111111111111111111';
const SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;
const MAGIC_WORD: Hex = `0x1626ba7e${'00'.repeat(28)}`;

function verifierReturning(respond: (callData: Hex) => Promise<{ data?: Hex }>) {
    const client = { call: vi.fn(({ data }: { data: Hex }) => respond(data)) } as unknown as PublicClient;
    const logger = { error: vi.fn() } as unknown as ConstructorParameters<typeof ERC1271Verifier>[1];
    return new ERC1271Verifier(client, logger);
}

describe('ERC1271Verifier', () => {
    const verify = (verifier: ERC1271Verifier) =>
        verifier.verifySmartAccountSignature(SIGNER, 'associate me', SIGNATURE, 506);

    it('accepts the ABI-encoded magic value', async () => {
        await expect(verify(verifierReturning(async () => ({ data: MAGIC_WORD })))).resolves.toBe(true);
    });

    it('rejects a contract that echoes its calldata', async () => {
        // The calldata starts with the isValidSignature selector, which equals the magic value.
        await expect(verify(verifierReturning(async (callData) => ({ data: callData })))).resolves.toBe(false);
    });

    it('rejects the magic value followed by extra bytes', async () => {
        await expect(verify(verifierReturning(async () => ({ data: `${MAGIC_WORD}ff` })))).resolves.toBe(false);
    });

    it.each<Hex>([
        '0x1626ba7e',
        `0x1626ba7e${'00'.repeat(27)}01`
    ])('rejects a magic value with invalid ABI encoding: %s', async (data) => {
        await expect(verify(verifierReturning(async () => ({ data })))).resolves.toBe(false);
    });

    it('rejects an empty response', async () => {
        await expect(verify(verifierReturning(async () => ({ data: undefined })))).resolves.toBe(false);
    });

    it('rejects when the call fails', async () => {
        await expect(verify(verifierReturning(async () => Promise.reject(new Error('revert'))))).resolves.toBe(false);
    });
});
