import { ForbiddenRpcError } from '#rpc/errors';
import type { JsonRpcResponse } from '#rpc/json-rpc';
import { type AnyParams, anyParams } from '#rpc/params-schemas';
import type { AuthorizedRpcContext, BaseContext, MethodHandler } from '#rpc/rpc-service';

export function forbiddenMethod(name: string): MethodHandler<BaseContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            _context: AuthorizedRpcContext,
            method: string,
            _params: unknown[],
            _id: number | string
        ): Promise<JsonRpcResponse> {
            throw new ForbiddenRpcError(`Method ${method} is forbidden`);
        }
    };
}
