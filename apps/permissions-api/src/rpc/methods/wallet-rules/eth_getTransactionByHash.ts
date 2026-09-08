import { z } from 'zod/v4';
import { type JsonRpcResponse, response } from '../../json-rpc';
import type { MethodHandler, WalletContext } from '../../rpc-service';

const paramsSchema = z.tuple([z.string()], z.unknown());

// Handler for getTransactionByHash that only returns transactions for the transaction hash stored in the allowance
export const eth_getTransactionByHash: MethodHandler<WalletContext, typeof paramsSchema> = {
    name: 'eth_getTransactionByHash',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [requestedTxHash] = params;

        const allowanceTxHash = await context.walletAuthorizer.getTxHash();

        if (requestedTxHash !== allowanceTxHash) {
            return response({ id, result: null });
        }

        return context.targetRpc.delegate(id, method, params);
    }
};
