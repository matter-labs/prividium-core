import type { z } from 'zod/v4';
import type { JsonRpcResponse } from '../json-rpc';
import { type AnyParams, anyParams } from '../params-schemas';
import type { MethodHandler, ServiceContext } from '../rpc-service';

/**
 * Creates a handler that forwards the request to the target RPC without any filtering.
 * Requires valid service authentication.
 */
function unrestrictedDelegate(name: string): MethodHandler<ServiceContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            context: ServiceContext,
            method: string,
            params: unknown[],
            id: number | string
        ): Promise<JsonRpcResponse> {
            await context.serviceAuthorizer.ensureIsService();
            return context.targetRpc.delegate(id, method, params);
        }
    };
}

export const serviceHandlers: MethodHandler<ServiceContext, z.ZodType>[] = [
    unrestrictedDelegate('eth_blockNumber'),
    unrestrictedDelegate('eth_getBlockByNumber'),
    unrestrictedDelegate('eth_getLogs'),
    unrestrictedDelegate('eth_getTransactionByHash'),
    unrestrictedDelegate('eth_getTransactionReceipt')
];
