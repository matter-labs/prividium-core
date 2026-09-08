import { RpcMethodNotFound } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { BaseContext, MethodHandler } from '../../rpc-service';

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
