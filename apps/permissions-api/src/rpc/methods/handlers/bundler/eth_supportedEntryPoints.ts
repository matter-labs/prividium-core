import type { JsonRpcResponse } from '../../../json-rpc';
import { type AnyParams, anyParams } from '../../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../../rpc-service';
import { isBundlerContext } from './utils/is-bundler-context';

export const eth_supportedEntryPoints: MethodHandler<AuthorizedRpcContext, AnyParams> = {
    name: 'eth_supportedEntryPoints',
    paramsSchema: anyParams,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        // 0. Ensure bundler is enabled
        isBundlerContext(context);

        // Forward to bundler - let bundler control which EntryPoints are supported
        return context.bundlerRpc.delegate(id, method, params);
    }
};
