import { ForbiddenRpcError } from '#rpc/errors';
import type { JsonRpcResponse } from '#rpc/json-rpc';
import { type AnyParams, anyParams } from '#rpc/params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '#rpc/rpc-service';

export function requireDeployPermission(name: string): MethodHandler<AuthorizedRpcContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            context: AuthorizedRpcContext,
            method: string,
            params: unknown[],
            id: number | string
        ): Promise<JsonRpcResponse> {
            if (!(await context.authorizer.hasDeploymentPermission())) {
                throw new ForbiddenRpcError(undefined, 'Missing deployment permission.');
            }

            return context.targetRpc.delegate(id, method, params);
        }
    };
}
