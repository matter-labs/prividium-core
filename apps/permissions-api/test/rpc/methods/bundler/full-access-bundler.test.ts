import { describe, expect, test } from 'vitest';
import type { AuthorizedRpcContext } from '../../../../src/rpc/rpc-service';
import { RpcCallHandler } from '../../../../src/rpc/rpc-service';
import { TestExternalRpc } from '../../test-external-rpc';
import { TestRpcAuthorizer } from '../../test-rpc-authorizer';

function createFullAccessContext(opts: { bundlerRpc: TestExternalRpc | null }): AuthorizedRpcContext {
    return {
        targetRpc: new TestExternalRpc(),
        bundlerRpc: opts.bundlerRpc,
        authorizer: (() => {
            const auth = new TestRpcAuthorizer();
            auth.setFullSequencerAccess(true);
            return auth;
        })(),
        logger: { info: () => {}, debug: () => {}, error: () => {} } as never,
        policyEnabled: false,
        deployment: null
    };
}

describe('full-access bundler routing', () => {
    test('bundler methods are delegated to bundlerRpc, not targetRpc', async () => {
        const bundlerRpc = new TestExternalRpc();
        const context = createFullAccessContext({ bundlerRpc });
        const handler = RpcCallHandler.forFullAccess(context);

        bundlerRpc.registerDelegate('1', {
            jsonrpc: '2.0',
            id: '1',
            result: '0xabc'
        });

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendUserOperation',
            params: [{ sender: '0x1234' }, '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108']
        });

        expect(bundlerRpc.delegateRegistry).toHaveLength(1);
        expect(bundlerRpc.delegateRegistry[0]).toMatchObject({
            method: 'eth_sendUserOperation'
        });

        // targetRpc should NOT have received the request
        expect((context.targetRpc as TestExternalRpc).delegateRegistry).toHaveLength(0);

        expect(result).toMatchObject({
            jsonrpc: '2.0',
            id: '1',
            result: '0xabc'
        });
    });

    test('bundler methods return Method not found when bundler is disabled', async () => {
        const context = createFullAccessContext({ bundlerRpc: null });
        const handler = RpcCallHandler.forFullAccess(context);

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendUserOperation',
            params: [{ sender: '0x1234' }, '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108']
        });

        expect(result).toMatchObject({
            error: {
                code: -32601,
                message: 'bundlerRpc is not enabled'
            }
        });
    });
});
