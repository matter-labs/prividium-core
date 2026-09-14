import { pad } from 'viem';
import { describe, expect, it } from 'vitest';
import { isReservedContractAddress } from './reserved-contract-address';

describe('reserved organization contract addresses', () => {
    it.each([
        '0x8000',
        '0x8008',
        '0x800A',
        '0xffff',
        '0x10000',
        '0x10003',
        '0x10004',
        '0x1000D',
        '0x1fFfF'
    ] as const)('rejects kernel and protocol predeploy address %s', (address) => {
        expect(isReservedContractAddress(pad(address, { size: 20 }))).toBe(true);
    });
    it.each([
        '0x00',
        '0x01',
        '0x7fff',
        '0x20000',
        '0xabcdef1234567890abcdef1234567890abcdef12'
    ] as const)('keeps address %s outside the reserved range', (address) => {
        expect(isReservedContractAddress(pad(address, { size: 20 }))).toBe(false);
    });
});
