import { ForbiddenRpcError, RpcMethodNotFound } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';

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
