import { ForbiddenRpcError, RpcMethodNotFound } from '#rpc/errors';
import type { JsonRpcResponse } from '#rpc/json-rpc';
import { type AnyParams, anyParams } from '#rpc/params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '#rpc/rpc-service';

export function requireFullReadAccess(
    name: string,
    rpc: 'targetRpc' | 'bundlerRpc' = 'targetRpc'
): MethodHandler<AuthorizedRpcContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            context: AuthorizedRpcContext,
            method: string,
            params: unknown[],
            id: number | string
        ): Promise<JsonRpcResponse> {
            if (!(await context.authorizer.hasFullReadAccess())) {
                throw new ForbiddenRpcError(`Expected user to have full read access but it didn't`);
            }

            const target = context[rpc];
            if (!target) {
                throw new RpcMethodNotFound(`${rpc} is not enabled`);
            }
            return target.delegate(id, method, params);
        }
    };
}
