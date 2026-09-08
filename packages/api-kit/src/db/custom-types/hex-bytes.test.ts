import { describe, expect, it } from 'vitest';
import { hexBytes } from '../custom-types';

describe('hexBytesColumn', () => {
    it('returns empty Buffer for "0x"', () => {
        const emptyBuf = hexBytes.toDriver('0x');
        expect(emptyBuf).toBeInstanceOf(Buffer);
        expect(emptyBuf.byteLength).toBe(0);
    });

    it('returns empty Buffer for "0x0"', () => {
        const emptyBuf2 = hexBytes.toDriver('0x0');
        expect(emptyBuf2).toBeInstanceOf(Buffer);
        expect(emptyBuf2.byteLength).toBe(0);
    });

    it('pads odd-length hex before converting', () => {
        const paddedBuf = hexBytes.toDriver('0xabc');
        expect(paddedBuf).toEqual(Buffer.from('0abc', 'hex'));
    });

    it('fromDriver returns canonical even-length hex', () => {
        const fromPadded = hexBytes.fromDriver(Buffer.from('0abc', 'hex'));
        expect(fromPadded).toBe('0x0abc');
    });

    it('round-trips even-length hex', () => {
        const buf = hexBytes.toDriver('0xdeadbeef');
        expect(buf).toEqual(Buffer.from('deadbeef', 'hex'));
        expect(hexBytes.fromDriver(buf)).toBe('0xdeadbeef');
    });

    it('throws on invalid hex input', () => {
        expect(() => hexBytes.toDriver('0xzz')).toThrow();
    });
});
