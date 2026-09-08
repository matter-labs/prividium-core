import { describe, expect, it } from 'vitest';
import { hexBigInt } from '../custom-types';

describe('hexBigIntColumn', () => {
    it('converts 0x0 to "0" for the driver', () => {
        expect(hexBigInt.toDriver('0x0')).toBe('0');
    });

    it('treats "0x" as zero', () => {
        expect(hexBigInt.toDriver('0x')).toBe('0');
    });

    it('converts a small hex quantity to its decimal string', () => {
        expect(hexBigInt.toDriver('0xff')).toBe('255');
    });

    it('preserves precision past Number.MAX_SAFE_INTEGER', () => {
        // 2^60 = 1152921504606846976
        expect(hexBigInt.toDriver('0x1000000000000000')).toBe('1152921504606846976');
    });

    it('rejects negative values', () => {
        // BigInt accepts no negative-hex literal, so simulate via the only path that could arrive here.
        expect(() => hexBigInt.toDriver('-0x1' as `0x${string}`)).toThrow();
    });

    it('rejects malformed hex', () => {
        expect(() => hexBigInt.toDriver('0xzz' as `0x${string}`)).toThrow();
    });

    it('parses driver decimal back to compact hex', () => {
        expect(hexBigInt.fromDriver('0')).toBe('0x0');
        expect(hexBigInt.fromDriver('255')).toBe('0xff');
    });

    it('round-trips bigint values past 2^53', () => {
        const big = '1152921504606846976'; // 2^60
        const hex = hexBigInt.fromDriver(big);
        expect(hex).toBe('0x1000000000000000');
        expect(hexBigInt.toDriver(hex)).toBe(big);
    });
});
