import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, BaseContext, MethodHandler } from '../../rpc-service';

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
