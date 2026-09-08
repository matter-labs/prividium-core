import pino from 'pino';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { TestExternalRpc } from '../../test/rpc/test-external-rpc';
import { TestRpcAuthorizer } from '../../test/rpc/test-rpc-authorizer';
import { hexSchema } from '../utils/schemas/hex-schema';
import {
    BAD_RPC_PARAMS_ERROR_CODE,
    FORBIDDEN_ERROR_CODE,
    INTERNAL_RPC_ERROR,
    METHOD_NOT_FOUND_ERROR_CODE
} from './constants';
import { ForbiddenRpcError, InvalidRpcRequest, WrongArguments } from './errors';
import { MAX_RPC_BATCH_SIZE } from './json-rpc';
import { eth_getBlockReceipts } from './methods/handlers/eth_getBlockReceipts';
import { eth_getLogs } from './methods/handlers/eth_getLogs';
import { eth_getTransactionByHash } from './methods/handlers/eth_getTransactionByHash';
import { eth_getTransactionReceipt } from './methods/handlers/eth_getTransactionReceipt';
import { type AnyParams, anyParams } from './params-schemas';
import { type AuthorizedRpcContext, type MethodHandler, RpcCallHandler } from './rpc-service';
import { TargetRpcCallError } from './target-rpc';

function makeContext(): AuthorizedRpcContext {
    return {
        targetRpc: {} as never,
        bundlerRpc: null,
        logger: pino({ level: 'silent' }),
        authorizer: {} as never,
        policyEnabled: false,
        deployment: null
    };
}

function jsonRpcRequest(method: string, params: unknown[], id: number | string = 1) {
    return { jsonrpc: '2.0' as const, id, method, params };
}

describe('RpcCallHandler paramsSchema validation', () => {
    const strictSchema = z.tuple([hexSchema], z.unknown());

    it('returns -32602 when params fail schema validation', async () => {
        const handle = vi.fn();
        const handler: MethodHandler<AuthorizedRpcContext, typeof strictSchema> = {
            name: 'test_method',
            paramsSchema: strictSchema,
            handle
        };

        const rpc = new RpcCallHandler([handler], makeContext());
        const result = await rpc.handle(jsonRpcRequest('test_method', [null]));

        expect(handle).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            error: { code: BAD_RPC_PARAMS_ERROR_CODE }
        });
    });

    it('calls handle with validated params on valid input', async () => {
        const handle = vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 1, result: 'ok' });
        const handler: MethodHandler<AuthorizedRpcContext, typeof strictSchema> = {
            name: 'test_method',
            paramsSchema: strictSchema,
            handle
        };
        expectTypeOf<Parameters<typeof handler.handle>[2]>().toEqualTypeOf<z.infer<typeof strictSchema>>();

        const rpc = new RpcCallHandler([handler], makeContext());
        const result = await rpc.handle(jsonRpcRequest('test_method', ['0xabc']));

        expect(handle).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ result: 'ok' });
    });

    it('accepts any params with anyParams schema', async () => {
        const handle = vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 1, result: 'ok' });
        const handler: MethodHandler<AuthorizedRpcContext, AnyParams> = {
            name: 'open_method',
            paramsSchema: anyParams,
            handle
        };
        expectTypeOf<Parameters<typeof handler.handle>[2]>().toEqualTypeOf<unknown[]>();

        const rpc = new RpcCallHandler([handler], makeContext());
        const result = await rpc.handle(jsonRpcRequest('open_method', [null, 123, 'anything']));

        expect(handle).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ result: 'ok' });
    });
});

describe('RpcCallHandler batch size cap', () => {
    function echoHandler(handle = vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 1, result: 'ok' })) {
        return {
            handler: { name: 'open_method', paramsSchema: anyParams, handle } as MethodHandler<
                AuthorizedRpcContext,
                AnyParams
            >,
            handle
        };
    }

    it('dispatches a batch at the MAX_RPC_BATCH_SIZE limit', async () => {
        const { handler, handle } = echoHandler();
        const rpc = new RpcCallHandler([handler], makeContext());

        const batch = Array.from({ length: MAX_RPC_BATCH_SIZE }, (_, i) => jsonRpcRequest('open_method', [], i));
        const result = await rpc.handle(batch);

        expect(Array.isArray(result)).toBe(true);
        expect(handle).toHaveBeenCalledTimes(MAX_RPC_BATCH_SIZE);
    });

    it('rejects an over-limit batch before invoking any handler', async () => {
        const { handler, handle } = echoHandler();
        const rpc = new RpcCallHandler([handler], makeContext());

        const batch = Array.from({ length: MAX_RPC_BATCH_SIZE + 1 }, (_, i) => jsonRpcRequest('open_method', [], i));

        await expect(rpc.handle(batch)).rejects.toBeInstanceOf(InvalidRpcRequest);
        expect(handle).not.toHaveBeenCalled();
    });
});

describe('RpcCallHandler default handler', () => {
    it('returns -32601 method not found for unregistered methods', async () => {
        const rpc = new RpcCallHandler([], makeContext());
        const result = await rpc.handle(jsonRpcRequest('does_not_exist', []));

        expect(result).toMatchObject({
            error: {
                code: METHOD_NOT_FOUND_ERROR_CODE,
                message: 'Method does_not_exist not found'
            }
        });
    });
});

describe('RpcCallHandler permission-denial logging', () => {
    function forbiddenHandler(): MethodHandler<AuthorizedRpcContext, AnyParams> {
        return {
            name: 'eth_call',
            paramsSchema: anyParams,
            handle: () => {
                throw new ForbiddenRpcError(undefined, 'Permission check for method call returned false', {
                    from: '0xabc',
                    to: '0xdef',
                    data: '0x100'
                });
            }
        };
    }

    it('emits a structured warn (not debug) when a handler throws ForbiddenRpcError', async () => {
        const context = makeContext();
        const warn = vi.spyOn(context.logger, 'warn');
        const debug = vi.spyOn(context.logger, 'debug');

        const rpc = new RpcCallHandler([forbiddenHandler()], context);
        const result = await rpc.handle(jsonRpcRequest('eth_call', [{}], 7));

        // Still returns the JSON-RPC forbidden error to the caller.
        expect(result).toMatchObject({ id: 7, error: { code: FORBIDDEN_ERROR_CODE } });

        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'rpc.permission_denied',
                method: 'eth_call',
                rpcReqId: 7,
                reason: 'Permission check for method call returned false'
            }),
            expect.any(String)
        );
        // The denial must not be downgraded to debug.
        expect(debug).not.toHaveBeenCalled();
    });

    it('logs the human-readable cause when a denial sets only `message` (reason defaults to "unknown")', async () => {
        const context = makeContext();
        const warn = vi.spyOn(context.logger, 'warn');

        // Common construction `new ForbiddenRpcError('…')`: cause in `message`, `reason` defaults to 'unknown'.
        const handler: MethodHandler<AuthorizedRpcContext, AnyParams> = {
            name: 'eth_sendRawTransaction',
            paramsSchema: anyParams,
            handle: () => {
                throw new ForbiddenRpcError('Transaction not authorized');
            }
        };

        const rpc = new RpcCallHandler([handler], context);
        await rpc.handle(jsonRpcRequest('eth_sendRawTransaction', [{}], 9));

        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'rpc.permission_denied',
                denialMessage: 'Transaction not authorized'
            }),
            expect.any(String)
        );
    });

    it('keeps non-forbidden RpcExceptions at debug level', async () => {
        const context = makeContext();
        const warn = vi.spyOn(context.logger, 'warn');
        const debug = vi.spyOn(context.logger, 'debug');

        const handler: MethodHandler<AuthorizedRpcContext, AnyParams> = {
            name: 'eth_call',
            paramsSchema: anyParams,
            handle: () => {
                throw new WrongArguments('bad');
            }
        };

        const rpc = new RpcCallHandler([handler], context);
        await rpc.handle(jsonRpcRequest('eth_call', [{}], 8));

        expect(debug).toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('RpcCallHandler upstream node errors', () => {
    const reqId = 'someid';
    const txHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';

    function setup(err: Error) {
        const targetRpc = new TestExternalRpc();
        targetRpc.registerSendError(reqId, err);
        const context = { ...makeContext(), targetRpc, authorizer: new TestRpcAuthorizer() };
        const rpc = new RpcCallHandler(
            [eth_getTransactionReceipt, eth_getTransactionByHash, eth_getBlockReceipts, eth_getLogs],
            context
        );
        return { context, rpc };
    }

    function nodeError(method: string) {
        return new TargetRpcCallError(method, BAD_RPC_PARAMS_ERROR_CODE, 'invalid argument', { field: 'hash' });
    }

    it.each([
        ['eth_getTransactionReceipt', [txHash]],
        ['eth_getTransactionByHash', [txHash]],
        ['eth_getBlockReceipts', ['0x1d1551']]
    ])('passes the node envelope through on %s', async (method, params) => {
        const { context, rpc } = setup(nodeError(method));
        const error = vi.spyOn(context.logger, 'error');
        const debug = vi.spyOn(context.logger, 'debug');

        const result = await rpc.handle(jsonRpcRequest(method, params, reqId));

        expect(result).toEqual({
            jsonrpc: '2.0',
            id: reqId,
            error: { code: BAD_RPC_PARAMS_ERROR_CODE, message: 'invalid argument', data: { field: 'hash' } }
        });
        expect(error).toHaveBeenCalled();
        expect(debug).not.toHaveBeenCalled();
    });

    it('masks the node envelope on eth_getLogs', async () => {
        const { context, rpc } = setup(nodeError('eth_getLogs'));
        const error = vi.spyOn(context.logger, 'error');

        const result = await rpc.handle(jsonRpcRequest('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x100' }], reqId));

        expect(result).toEqual({
            jsonrpc: '2.0',
            id: reqId,
            error: { code: INTERNAL_RPC_ERROR, message: 'Internal error' }
        });
        expect(error).toHaveBeenCalled();
    });

    it('still returns -32603 when the transport fails', async () => {
        const { rpc } = setup(new Error('error calling target rpc: "eth_getTransactionReceipt"'));

        const result = await rpc.handle(jsonRpcRequest('eth_getTransactionReceipt', [txHash], reqId));

        expect(result).toEqual({
            jsonrpc: '2.0',
            id: reqId,
            error: { code: INTERNAL_RPC_ERROR, message: 'Internal error' }
        });
    });
});
