import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';

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
