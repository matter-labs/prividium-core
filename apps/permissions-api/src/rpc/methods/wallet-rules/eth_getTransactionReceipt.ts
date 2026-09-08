import { z } from 'zod/v4';
import { ZERO_LOGS_BLOOM } from '../../constants';
import { type JsonRpcResponse, response } from '../../json-rpc';
import type { MethodHandler, WalletContext } from '../../rpc-service';

const paramsSchema = z.tuple([z.string()], z.unknown());

// Handler for getTransactionReceipt that only returns receipts for the transaction hash stored in the allowance
export const eth_getTransactionReceipt: MethodHandler<WalletContext, typeof paramsSchema> = {
    name: 'eth_getTransactionReceipt',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [requestedTxHash] = params;

        const allowanceTxHash = await context.walletAuthorizer.getTxHash();

        if (requestedTxHash !== allowanceTxHash) {
            return response({ id, result: null });
        }

        const delegated = await context.targetRpc.delegate(id, method, params);

        if (
            'error' in delegated ||
            !delegated.result ||
            typeof delegated.result !== 'object' ||
            Array.isArray(delegated.result)
        ) {
            return delegated;
        }

        return response({ id, result: { ...delegated.result, logsBloom: ZERO_LOGS_BLOOM } });
    }
};
