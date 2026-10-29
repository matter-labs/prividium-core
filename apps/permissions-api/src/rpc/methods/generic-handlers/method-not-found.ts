import { RpcMethodNotFound } from '#rpc/errors';
import type { JsonRpcResponse } from '#rpc/json-rpc';
import { type AnyParams, anyParams } from '#rpc/params-schemas';
import type { BaseContext, MethodHandler } from '#rpc/rpc-service';

export function methodNotFound(name: string): MethodHandler<BaseContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            _context: BaseContext,
            method: string,
            _params: unknown[],
            _id: number | string
        ): Promise<JsonRpcResponse> {
            throw new RpcMethodNotFound(`Method ${method} not found`);
        }
    };
}
