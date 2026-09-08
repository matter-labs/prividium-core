import { describe, expect, it } from 'vitest';
import { createContractSchema, updateContractSchema } from './contracts-repository';

describe('createContractSchema', () => {
    it('defaults omitted disclosure fields to false', () => {
        const contract = createContractSchema.parse({
            contractAddress: '0x2234567890123456789012345678901234567890',
            abi: '[]',
            name: null,
            description: null,
            disclosureStartBlock: '0x00'
        });

        expect(contract.discloseErc20TotalSupply).toBe(false);
        expect(contract.discloseBytecode).toBe(false);
        expect(contract.disclosedAddresses).toEqual([]);
    });
});

describe('updateContractSchema', () => {
    it('requires disclosure fields for full contract replacement', () => {
        const result = updateContractSchema.safeParse({
            contractAddress: '0x2234567890123456789012345678901234567890',
            abi: '[]',
            name: null,
            description: null,
            disclosureStartBlock: '0x00'
        });

        expect(result.success).toBe(false);
    });
});

describe('disclosureStartBlock', () => {
    it('fails if its not hex', () => {
        const result = updateContractSchema.safeParse({
            contractAddress: '0x2234567890123456789012345678901234567890',
            abi: '[]',
            name: null,
            description: null,
            disclosureStartBlock: '17'
        });

        expect(result.success).toBe(false);
    });
});
