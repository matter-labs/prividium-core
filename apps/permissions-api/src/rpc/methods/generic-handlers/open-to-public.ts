import type { JsonRpcResponse } from '#rpc/json-rpc';
import { type AnyParams, anyParams } from '#rpc/params-schemas';
import type { BaseContext, MethodHandler } from '#rpc/rpc-service';

/**
 *  Allows a method to be exposed to the public (does not require a valid auth token);
 */
export function openToPublic(name: string): MethodHandler<BaseContext, AnyParams> {
    return {
        name,
        paramsSchema: anyParams,
        async handle(
            context: BaseContext,
            method: string,
            params: unknown[],
            id: number | string
        ): Promise<JsonRpcResponse> {
            return context.targetRpc.delegate(id, method, params);
        }
    };
}
