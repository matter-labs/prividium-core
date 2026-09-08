import { describe, expect, it } from 'vitest';
import { stableStringify } from './stable-stringify';

describe('stableStringify', () => {
    it('stabilizes top-level key ordering', () => {
        const schemaA = { type: 'object', properties: { b: 2, a: 1 } };
        const schemaB = { properties: { a: 1, b: 2 }, type: 'object' };

        expect(stableStringify(schemaA)).toBe(stableStringify(schemaB));
        expect(JSON.stringify(schemaA)).not.toBe(JSON.stringify(schemaB));
    });

    it('stabilizes nested key ordering in schema-like objects', () => {
        const schemaA = {
            type: 'object',
            properties: {
                b: { type: 'string' },
                a: { type: 'number' }
            },
            required: ['a', 'b']
        };
        const schemaB = {
            required: ['a', 'b'],
            properties: {
                a: { type: 'number' },
                b: { type: 'string' }
            },
            type: 'object'
        };

        expect(stableStringify(schemaA)).toBe(stableStringify(schemaB));
        expect(JSON.stringify(schemaA)).not.toBe(JSON.stringify(schemaB));
    });

    it('preserves array order differences', () => {
        const schemaA = { oneOf: [{ type: 'string' }, { type: 'number' }] };
        const schemaB = { oneOf: [{ type: 'number' }, { type: 'string' }] };

        expect(stableStringify(schemaA)).not.toBe(stableStringify(schemaB));
    });
});
