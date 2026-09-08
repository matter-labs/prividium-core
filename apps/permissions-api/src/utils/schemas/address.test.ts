import { describe, expect, it } from 'vitest';
import { addressSchema } from './address';

describe('addressSchema', () => {
    describe('valid addresses', () => {
        it('should accept valid lowercase address', () => {
            const address = '0x1234567890123456789012345678901234567890';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x1234567890123456789012345678901234567890');
        });

        it('should accept valid uppercase address', () => {
            const address = '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD');
        });

        it('should accept valid mixed case checksummed address', () => {
            const address = '0x5aAeb6053f3E94C9b9A09f33669435E7Ef1BeAed';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
        });

        it('should accept zero address', () => {
            const address = '0x0000000000000000000000000000000000000000';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x0000000000000000000000000000000000000000');
        });

        it('should accept max address', () => {
            const address = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF');
        });
    });

    describe('invalid addresses', () => {
        it('should reject address without 0x prefix', () => {
            const address = '1234567890123456789012345678901234567890';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(false);
        });

        it('should reject address with wrong length (too short)', () => {
            const address = '0x123456789012345678901234567890123456789';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(false);
        });

        it('should reject address with wrong length (too long)', () => {
            const address = '0x12345678901234567890123456789012345678901';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(false);
        });

        it('should reject address with invalid characters', () => {
            const address = '0xGGGG567890123456789012345678901234567890';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(false);
        });

        it('should reject address with spaces', () => {
            const address = '0x12345678 90123456789012345678901234567890';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(false);
        });

        it('should reject empty string', () => {
            const address = '';
            const result = addressSchema.safeParse(address);
            expect(result.success).toBe(false);
        });

        it('should reject null', () => {
            const result = addressSchema.safeParse(null);
            expect(result.success).toBe(false);
        });

        it('should reject undefined', () => {
            const result = addressSchema.safeParse(undefined);
            expect(result.success).toBe(false);
        });

        it('should reject number', () => {
            const result = addressSchema.safeParse(123456);
            expect(result.success).toBe(false);
        });

        it('should reject object', () => {
            const result = addressSchema.safeParse({ address: '0x1234567890123456789012345678901234567890' });
            expect(result.success).toBe(false);
        });
    });
});
