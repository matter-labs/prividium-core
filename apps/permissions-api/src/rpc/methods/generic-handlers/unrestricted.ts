import type { JsonRpcResponse } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';

/**
 * Unrestricted methods can be called for any user with a valid Prividium™ account with
 * no restriction over the parameters or the response.
 */
export function unrestricted(name: string): MethodHandler<AuthorizedRpcContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            context: AuthorizedRpcContext,
            method: string,
            params: unknown[],
            id: number | string
        ): Promise<JsonRpcResponse> {
            await context.authorizer.ensureUserExists();

            return context.targetRpc.delegate(id, method, params);
        }
    };
}
