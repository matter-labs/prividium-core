import { describe, expect, it } from 'vitest';
import { EVM_ADDRESSES, isEvmAddress } from './addresses';

const checksummed = '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049';

describe('EVM addresses', () => {
    it('parses any letter case into the checksummed form', () => {
        expect(EVM_ADDRESSES.schema.parse(checksummed.toLowerCase())).toBe(checksummed);
        expect(EVM_ADDRESSES.pattern.test(checksummed)).toBe(true);
    });

    it('refuses anything that is not a 20-byte hex address', () => {
        expect(() => EVM_ADDRESSES.schema.parse('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')).toThrow();
        expect(() => EVM_ADDRESSES.schema.parse(checksummed.slice(0, 41))).toThrow();
    });

    it('compares spellings of one address as equal', () => {
        expect(EVM_ADDRESSES.equals(checksummed, checksummed.toLowerCase())).toBe(true);
        expect(EVM_ADDRESSES.equals(checksummed, `0x${'1'.repeat(40)}`)).toBe(false);
    });

    it('stores 20 bytes and reads them back checksummed', () => {
        const bytes = EVM_ADDRESSES.toBytes(checksummed.toLowerCase());
        expect(bytes).toHaveLength(20);
        expect(EVM_ADDRESSES.fromBytes(bytes)).toBe(checksummed);
    });

    it('narrows a stored address to the EVM type', () => {
        expect(isEvmAddress(checksummed)).toBe(true);
        expect(isEvmAddress('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')).toBe(false);
    });
});
