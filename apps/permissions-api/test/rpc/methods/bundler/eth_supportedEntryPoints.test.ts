import { describe, expect } from 'vitest';
import { eth_supportedEntryPoints } from '../../../../src/rpc/methods/handlers/bundler/eth_supportedEntryPoints';
import { it } from '../../test-bundler-env';

describe('eth_supportedEntryPoints', () => {
    const method = eth_supportedEntryPoints;

    it('delegates to bundler and returns supported entry points', async ({ reqContext, bundlerRpc }) => {
        const entryPoints = ['0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'];

        bundlerRpc.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            result: entryPoints
        });

        const result = await method.handle(reqContext, 'eth_supportedEntryPoints', [], 'req-1');

        expect(result).toMatchObject({
            jsonrpc: '2.0',
            id: 'req-1',
            result: entryPoints
        });

        expect(bundlerRpc.delegateRegistry).toHaveLength(1);
        expect(bundlerRpc.delegateRegistry[0]).toMatchObject({
            id: 'req-1',
            method: 'eth_supportedEntryPoints',
            params: []
        });
    });
});
