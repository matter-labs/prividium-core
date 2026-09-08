import { describe, expect, it } from 'vitest';
import { hexSchema, hexSizedSchema, methodSelectorSchema } from './hex-schema';

describe('hexSchema', () => {
    describe('valid hex strings', () => {
        it('should accept empty hex string (0x)', () => {
            const result = hexSchema.safeParse('0x');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x');
        });

        it('should accept single byte hex', () => {
            const result = hexSchema.safeParse('0xff');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xff');
        });

        it('should accept lowercase hex string', () => {
            const result = hexSchema.safeParse('0xabcdef1234567890');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xabcdef1234567890');
        });

        it('should accept uppercase hex string', () => {
            const result = hexSchema.safeParse('0xABCDEF1234567890');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xABCDEF1234567890');
        });

        it('should accept mixed case hex string', () => {
            const result = hexSchema.safeParse('0xAbCdEf1234567890');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xAbCdEf1234567890');
        });

        it('should accept very long hex string', () => {
            const longHex = `0x${'a'.repeat(1000)}`;
            const result = hexSchema.safeParse(longHex);
            expect(result.success).toBe(true);
            expect(result.data).toBe(longHex);
        });

        it('should accept hex string with all zeros', () => {
            const result = hexSchema.safeParse('0x0000000000000000');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x0000000000000000');
        });

        it('should accept hex string with all Fs', () => {
            const result = hexSchema.safeParse('0xFFFFFFFFFFFFFFFF');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xFFFFFFFFFFFFFFFF');
        });
    });

    describe('invalid hex strings', () => {
        it('should reject string without 0x prefix', () => {
            const result = hexSchema.safeParse('abcdef1234567890');
            expect(result.success).toBe(false);
        });

        it('should reject string with invalid hex characters', () => {
            const result = hexSchema.safeParse('0xGGGG');
            expect(result.success).toBe(false);
        });

        it('should reject string with spaces', () => {
            const result = hexSchema.safeParse('0xab cd ef');
            expect(result.success).toBe(false);
        });

        it('should reject string with special characters', () => {
            const result = hexSchema.safeParse('0x!@#$');
            expect(result.success).toBe(false);
        });

        it('should reject empty string', () => {
            const result = hexSchema.safeParse('');
            expect(result.success).toBe(false);
        });

        it('should reject null', () => {
            const result = hexSchema.safeParse(null);
            expect(result.success).toBe(false);
        });

        it('should reject undefined', () => {
            const result = hexSchema.safeParse(undefined);
            expect(result.success).toBe(false);
        });

        it('should reject number', () => {
            const result = hexSchema.safeParse(123456);
            expect(result.success).toBe(false);
        });

        it('should reject object', () => {
            const result = hexSchema.safeParse({ hex: '0xabcdef' });
            expect(result.success).toBe(false);
        });

        it('should reject just 0 without x', () => {
            const result = hexSchema.safeParse('0');
            expect(result.success).toBe(false);
        });

        it('should reject 0X uppercase prefix', () => {
            const result = hexSchema.safeParse('0Xabcdef');
            expect(result.success).toBe(false);
        });
    });
});

describe('hexSizedSchema', () => {
    describe('32 byte hex (64 chars)', () => {
        const schema = hexSizedSchema(32);

        it('should accept valid 32 byte hex string', () => {
            const hex32 = `0x${'1234567890abcdef'.repeat(4)}`;
            const result = schema.safeParse(hex32);
            expect(result.success).toBe(true);
            expect(result.data).toBe(hex32);
        });

        it('should accept 32 byte hex with all zeros', () => {
            const hex32 = `0x${'0'.repeat(64)}`;
            const result = schema.safeParse(hex32);
            expect(result.success).toBe(true);
            expect(result.data).toBe(hex32);
        });

        it('should reject 31 byte hex string', () => {
            const hex31 = `0x${'0'.repeat(62)}`;
            const result = schema.safeParse(hex31);
            expect(result.success).toBe(false);
        });

        it('should reject 33 byte hex string', () => {
            const hex33 = `0x${'0'.repeat(66)}`;
            const result = schema.safeParse(hex33);
            expect(result.success).toBe(false);
        });
    });

    describe('1 byte hex (2 chars)', () => {
        const schema = hexSizedSchema(1);

        it('should accept valid 1 byte hex string', () => {
            const result = schema.safeParse('0xff');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xff');
        });

        it('should accept 1 byte hex with zero', () => {
            const result = schema.safeParse('0x00');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x00');
        });

        it('should reject single character hex', () => {
            const result = schema.safeParse('0xa');
            expect(result.success).toBe(false);
        });

        it('should reject three character hex', () => {
            const result = schema.safeParse('0xabc');
            expect(result.success).toBe(false);
        });
    });

    describe('0 byte hex (empty)', () => {
        const schema = hexSizedSchema(0);

        it('should accept 0x for 0 bytes', () => {
            const result = schema.safeParse('0x');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x');
        });

        it('should reject any hex data for 0 bytes', () => {
            const result = schema.safeParse('0x00');
            expect(result.success).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('should handle 20 byte hex (address size)', () => {
            const schema = hexSizedSchema(20);
            const address = `0x${'1234567890'.repeat(4)}`;
            const result = schema.safeParse(address);
            expect(result.success).toBe(true);
            expect(result.data).toBe(address);
        });

        it('should reject invalid hex characters in sized schema', () => {
            const schema = hexSizedSchema(4);
            const result = schema.safeParse('0xGGGGHHHH');
            expect(result.success).toBe(false);
        });

        it('should reject spaces in sized hex', () => {
            const schema = hexSizedSchema(4);
            const result = schema.safeParse('0x1234 5678');
            expect(result.success).toBe(false);
        });
    });
});

describe('methodSelectorSchema', () => {
    describe('valid method selectors', () => {
        it('should accept valid 4 byte method selector', () => {
            const result = methodSelectorSchema.safeParse('0xa9059cbb');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xa9059cbb');
        });

        it('should accept empty selector 0x', () => {
            const result = methodSelectorSchema.safeParse('0x');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x');
        });

        it('should accept method selector with all zeros', () => {
            const result = methodSelectorSchema.safeParse('0x00000000');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0x00000000');
        });

        it('should accept method selector with all Fs', () => {
            const result = methodSelectorSchema.safeParse('0xffffffff');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xffffffff');
        });

        it('should accept mixed case method selector', () => {
            const result = methodSelectorSchema.safeParse('0xAaBbCcDd');
            expect(result.success).toBe(true);
            expect(result.data).toBe('0xAaBbCcDd');
        });
    });

    describe('invalid method selectors', () => {
        it('should reject selector that is too short', () => {
            const result = methodSelectorSchema.safeParse('0x123456');
            expect(result.success).toBe(false);
        });

        it('should reject selector that is too long', () => {
            const result = methodSelectorSchema.safeParse('0x1234567890');
            expect(result.success).toBe(false);
        });

        it('should reject selector without 0x prefix', () => {
            const result = methodSelectorSchema.safeParse('a9059cbb');
            expect(result.success).toBe(false);
        });

        it('should reject selector with invalid hex characters', () => {
            const result = methodSelectorSchema.safeParse('0xGGGGHHHH');
            expect(result.success).toBe(false);
        });

        it('should reject empty string', () => {
            const result = methodSelectorSchema.safeParse('');
            expect(result.success).toBe(false);
        });

        it('should reject null', () => {
            const result = methodSelectorSchema.safeParse(null);
            expect(result.success).toBe(false);
        });

        it('should reject undefined', () => {
            const result = methodSelectorSchema.safeParse(undefined);
            expect(result.success).toBe(false);
        });

        it('should reject number', () => {
            const result = methodSelectorSchema.safeParse(123456);
            expect(result.success).toBe(false);
        });

        it('should reject object', () => {
            const result = methodSelectorSchema.safeParse({ selector: '0xa9059cbb' });
            expect(result.success).toBe(false);
        });
    });
});
