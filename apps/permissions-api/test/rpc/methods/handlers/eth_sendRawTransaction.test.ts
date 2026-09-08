// Unit-level coverage for the sync-upstream behavior on
// `eth_sendRawTransaction`. Exercises the full-sequencer-access handler
// since it's the leanest of the three (no perm check or wallet-allowance
// gating in between). Asserts:
//   1. The proxy forwards using `eth_sendRawTransactionSync` upstream.
//   2. A successful upstream receipt is reshaped to a tx-hash result.
//   3. Upstream errors are passed through unchanged (drift-deny, timeout).
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, test } from 'vitest';
import { ForbiddenRpcError } from '../../../../src/rpc/errors';
import { eth_sendRawTransaction } from '../../../../src/rpc/methods/handlers/eth_sendRawTransaction';
import type { AuthorizedRpcContext } from '../../../../src/rpc/rpc-service';
import { RpcCallHandler } from '../../../../src/rpc/rpc-service';
import { rpcUnitTest } from '../../rpc-unit-test-utils';
import { TestExternalRpc } from '../../test-external-rpc';
import { TestRpcAuthorizer } from '../../test-rpc-authorizer';

const SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function fullSequencerContext(): AuthorizedRpcContext {
    return {
        targetRpc: new TestExternalRpc(),
        bundlerRpc: null,
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

async function signRawTx(overrides: { to?: Hex; data?: Hex; value?: bigint } = {}): Promise<`0x${string}`> {
    const account = privateKeyToAccount(SIGNER_KEY);
    return account.signTransaction({
        chainId: 1,
        nonce: 0,
        to: overrides.to ?? '0x000000000000000000000000000000000000dead',
        value: overrides.value ?? 0n,
        data: overrides.data,
        gas: 21000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n
    });
}

const ACCEPTED_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';

function acceptedDelegateResponse(id: string) {
    return {
        jsonrpc: '2.0' as const,
        id,
        result: { transactionHash: ACCEPTED_HASH, blockNumber: '0x10', status: '0x1' }
    };
}

describe('eth_sendRawTransaction sync upstream', () => {
    test('forwards via eth_sendRawTransactionSync and returns the tx hash from the receipt', async () => {
        const context = fullSequencerContext();
        const handler = RpcCallHandler.forFullAccess(context);
        const target = context.targetRpc as TestExternalRpc;
        const rawTx = await signRawTx();
        const txHash = '0x1111111111111111111111111111111111111111111111111111111111111111';

        target.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            result: { transactionHash: txHash, blockNumber: '0x10', status: '0x1' }
        });

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'eth_sendRawTransaction',
            params: [rawTx]
        });

        expect(target.delegateRegistry).toEqual([
            { id: 'req-1', method: 'eth_sendRawTransactionSync', params: [rawTx] }
        ]);
        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: txHash });
    });

    test('passes through upstream RejectedDuringExecution errors (-32003)', async () => {
        // Surfaces the drift case: chain's block-build /admit + /judge denies
        // a tx that the RPC-entry pass allowed (e.g. permission row removed
        // between checkpoints). Async sendRaw would have returned a hash and
        // stranded the caller.
        const context = fullSequencerContext();
        const handler = RpcCallHandler.forFullAccess(context);
        const target = context.targetRpc as TestExternalRpc;
        const rawTx = await signRawTx();

        target.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: -32003, message: 'transaction rejected during execution: FilteredByValidator' }
        });

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'eth_sendRawTransaction',
            params: [rawTx]
        });

        expect(result).toMatchObject({
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: -32003, message: expect.stringContaining('FilteredByValidator') }
        });
    });

    test('passes through EIP-7966 timeout (code 4) when sync wait exhausts', async () => {
        const context = fullSequencerContext();
        const handler = RpcCallHandler.forFullAccess(context);
        const target = context.targetRpc as TestExternalRpc;
        const rawTx = await signRawTx();

        target.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: 4, message: 'transaction not mined within timeout' }
        });

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'eth_sendRawTransaction',
            params: [rawTx]
        });

        expect(result).toMatchObject({
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: 4 }
        });
    });
});

describe('eth_sendRawTransaction on a besu target', () => {
    test('forwards via plain eth_sendRawTransaction and returns the hash', async () => {
        const context = fullSequencerContext();
        const handler = RpcCallHandler.forFullAccess(context);
        const target = context.targetRpc as TestExternalRpc;
        target.chainType = 'besu';
        const rawTx = await signRawTx();

        target.registerDelegate('req-1', { jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'eth_sendRawTransaction',
            params: [rawTx]
        });

        expect(target.delegateRegistry).toEqual([{ id: 'req-1', method: 'eth_sendRawTransaction', params: [rawTx] }]);
        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });
    });

    test('passes through submission errors unchanged', async () => {
        const context = fullSequencerContext();
        const handler = RpcCallHandler.forFullAccess(context);
        const target = context.targetRpc as TestExternalRpc;
        target.chainType = 'besu';
        const rawTx = await signRawTx();

        target.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: -32000, message: 'nonce too low' }
        });

        const result = await handler.handle({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'eth_sendRawTransaction',
            params: [rawTx]
        });

        expect(result).toMatchObject({ jsonrpc: '2.0', id: 'req-1', error: { code: -32000 } });
    });
});

const EOA = '0x0000000000000000000000000000000000001111';
const CONTRACT = '0x0000000000000000000000000000000000002222';
const CONTRACT_BYTECODE = '0x60016002';
// A ZKsync OS system contract: a real contract that reports empty code via getCode.
const CODELESS_CONTRACT = '0x0000000000000000000000000000000000008006';

describe('eth_sendRawTransaction permission enforcement', () => {
    rpcUnitTest(
        'allows a value transfer to an EOA without a permission check',
        async ({ reqContext, rpc, authorizer }) => {
            authorizer.setAllowRead(false); // proves the check is skipped, not merely passing
            rpc.registerCodeFor(EOA, '0x');
            rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
            const rawTx = await signRawTx({ to: EOA, data: '0x', value: 1n });

            const result = await eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1');
            expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });
        }
    );

    rpcUnitTest('denies a value transfer to a contract without permission', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(false);
        rpc.registerCodeFor(CONTRACT, CONTRACT_BYTECODE);
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: CONTRACT, data: '0x', value: 1n });

        await expect(
            eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1')
        ).rejects.toBeInstanceOf(ForbiddenRpcError);
    });

    // A codeless address is indistinguishable from an EOA and runs no code on a value transfer.
    rpcUnitTest('allows a value transfer to a codeless address', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(false);
        rpc.registerCodeFor(CODELESS_CONTRACT, '0x');
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: CODELESS_CONTRACT, data: '0x', value: 1n });

        const result = await eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1');
        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });
    });

    rpcUnitTest('denies an empty (no value, no calldata) tx to an EOA', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(false);
        rpc.registerCodeFor(EOA, '0x');
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: EOA, data: '0x', value: 0n });

        await expect(
            eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1')
        ).rejects.toBeInstanceOf(ForbiddenRpcError);
    });

    rpcUnitTest('denies an empty tx to a contract', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(false);
        rpc.registerCodeFor(CONTRACT, CONTRACT_BYTECODE);
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: CONTRACT, data: '0x', value: 0n });

        await expect(
            eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1')
        ).rejects.toBeInstanceOf(ForbiddenRpcError);
    });

    rpcUnitTest('denies a contract call to a contract without permission', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(false);
        rpc.registerCodeFor(CONTRACT, CONTRACT_BYTECODE);
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: CONTRACT, data: '0xdeadbeef' });

        await expect(
            eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1')
        ).rejects.toBeInstanceOf(ForbiddenRpcError);
    });

    rpcUnitTest(
        'denies a contract call to a codeless target without permission',
        async ({ reqContext, rpc, authorizer }) => {
            authorizer.setAllowRead(false);
            rpc.registerCodeFor(CODELESS_CONTRACT, '0x');
            rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
            const rawTx = await signRawTx({ to: CODELESS_CONTRACT, data: '0xdeadbeef' });

            await expect(
                eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1')
            ).rejects.toBeInstanceOf(ForbiddenRpcError);
        }
    );

    rpcUnitTest(
        'forwards a contract call to a codeless target when permitted',
        async ({ reqContext, rpc, authorizer }) => {
            authorizer.setAllowRead(true);
            rpc.registerCodeFor(CODELESS_CONTRACT, '0x');
            rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
            const rawTx = await signRawTx({ to: CODELESS_CONTRACT, data: '0xdeadbeef' });

            const result = await eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1');
            expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });
        }
    );

    rpcUnitTest('forwards a value transfer to a contract when permitted', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(true);
        rpc.registerCodeFor(CONTRACT, CONTRACT_BYTECODE);
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: CONTRACT, data: '0x', value: 1n });

        const result = await eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1');
        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });
    });

    rpcUnitTest('forwards a contract call when permitted', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setAllowRead(true);
        rpc.registerCodeFor(CONTRACT, CONTRACT_BYTECODE);
        rpc.registerDelegate('req-1', acceptedDelegateResponse('req-1'));
        const rawTx = await signRawTx({ to: CONTRACT, data: '0xdeadbeef' });

        const result = await eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1');
        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: ACCEPTED_HASH });
    });

    rpcUnitTest('denies a contract deployment without deploy permission', async ({ reqContext }) => {
        const account = privateKeyToAccount(SIGNER_KEY);
        const rawTx = await account.signTransaction({
            chainId: 1,
            nonce: 0,
            data: '0x60016002',
            gas: 100_000n,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n
        });

        await expect(
            eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [rawTx], 'req-1')
        ).rejects.toBeInstanceOf(ForbiddenRpcError);
    });
});
