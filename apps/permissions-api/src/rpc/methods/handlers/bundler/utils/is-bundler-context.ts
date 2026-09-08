import { RpcMethodNotFound } from '../../../../errors';
import type { AuthorizedRpcContext } from '../../../../rpc-service';
import type { ExternalRpc } from '../../../../target-rpc';

export type BundlerContext = AuthorizedRpcContext & { bundlerRpc: ExternalRpc };

export function isBundlerContext(context: AuthorizedRpcContext): asserts context is BundlerContext {
    if (!context.bundlerRpc) {
        throw new RpcMethodNotFound('Bundler is not enabled');
    }
}
