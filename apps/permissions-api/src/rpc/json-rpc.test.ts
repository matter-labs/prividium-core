import { describe, expect, it } from 'vitest';
import { responseOrBatch } from './json-rpc';

describe('responseOrBatch', () => {
    it.each([
        { name: 'jsonrpc', reply: { id: 1, result: '0x1' } },
        { name: 'id', reply: { jsonrpc: '2.0', error: { code: -32000, message: 'rejected' } } }
    ])('serializes a node reply without $name unchanged', ({ reply }) => {
        expect(responseOrBatch.parse(reply)).toEqual(reply);
        expect(responseOrBatch.parse([reply])).toEqual([reply]);
    });
});
