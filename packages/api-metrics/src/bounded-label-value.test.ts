import { describe, expect, it } from 'vitest';
import { boundedLabelValue } from './index';

const allowed = new Set(['eth_chainId', 'eth_call']);

describe('boundedLabelValue', () => {
    it('passes an allowed value through unchanged', () => {
        expect(boundedLabelValue(allowed, 'eth_call', 'unknown')).toBe('eth_call');
    });

    it('collapses any other value into the fallback', () => {
        expect(boundedLabelValue(allowed, 'x'.repeat(10_000), 'unknown')).toBe('unknown');
        expect(boundedLabelValue(allowed, '', 'unknown')).toBe('unknown');
        expect(boundedLabelValue(allowed, 'constructor', 'unknown')).toBe('unknown');
    });

    it('does not fall back to a case-insensitive match', () => {
        expect(boundedLabelValue(allowed, 'ETH_CALL', 'unknown')).toBe('unknown');
    });
});
