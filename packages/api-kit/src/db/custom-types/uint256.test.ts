import { describe, expect, it } from 'vitest';
import { uint256 } from '../custom-types';

describe('uint256Column', () => {
    it('converts bigint to string for driver', () => {
        const str = uint256.toDriver(12345678901234567890n);
        expect(str).toBe('12345678901234567890');
    });

    it('stores negative bigint correctly', () => {
        const str = uint256.toDriver(-9876543210987654321n);
        expect(str).toBe('-9876543210987654321');
    });

    it('stores max uint256 values correctly', () => {
        const maxUint256 = (1n << 256n) - 1n;
        const str = uint256.toDriver(maxUint256);
        expect(str).toBe('115792089237316195423570985008687907853269984665640564039457584007913129639935');
    });

    it('converts number to string for driver', () => {
        const str = uint256.toDriver(12345);
        expect(str).toBe('12345');
    });

    it('converts string to string for driver', () => {
        const str = uint256.toDriver('67890');
        expect(str).toBe('67890');
    });

    it('returns null for null/undefined input to driver', () => {
        expect(uint256.toDriver(null)).toBeNull();
    });

    it('converts string from driver to bigint', () => {
        const big = uint256.fromDriver('12345678901234567890');
        expect(big).toBe(12345678901234567890n);
    });

    it('returns null for null/undefined input from driver', () => {
        expect(uint256.fromDriver(null)).toBeNull();
    });
});
