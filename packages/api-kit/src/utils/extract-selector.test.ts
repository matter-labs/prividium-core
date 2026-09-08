import { describe, expect, it } from 'vitest';
import { extractSelector } from './extract-selector';

describe('extractSelector', () => {
    it('should extract the first 4 bytes from valid calldata', () => {
        // transfer(address,uint256) selector: 0xa9059cbb
        const calldata = '0xa9059cbb000000000000000000000000abcdef1234567890abcdef1234567890abcdef12';
        const result = extractSelector(calldata);
        expect(result).toBe('0xa9059cbb');
    });

    it('should extract selector from minimal valid calldata (exactly 4 bytes)', () => {
        const calldata = '0xa9059cbb';
        const result = extractSelector(calldata);
        expect(result).toBe('0xa9059cbb');
    });

    it('should throw for calldata shorter than 4 bytes', () => {
        const calldata = '0xa905'; // Only 2 bytes
        expect(() => extractSelector(calldata)).toThrow();
    });

    it('should throw for empty calldata', () => {
        const calldata = '0x';
        expect(() => extractSelector(calldata)).toThrow();
    });

    it('should throw for calldata with only 3 bytes', () => {
        const calldata = '0xa9059c'; // 3 bytes
        expect(() => extractSelector(calldata)).toThrow();
    });

    it('should handle longer calldata correctly', () => {
        // approve(address,uint256) selector: 0x095ea7b3
        const calldata =
            '0x095ea7b3000000000000000000000000spender00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffff';

        const result = extractSelector(calldata);
        expect(result).toBe('0x095ea7b3');
    });
});
