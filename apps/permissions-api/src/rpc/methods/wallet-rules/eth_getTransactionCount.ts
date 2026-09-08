import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import type { MethodHandler, WalletContext } from '../../rpc-service';

const paramsSchema = z.tuple([addressSchema], z.unknown());

// Handler for getTransactionCount that returns the real nonce only for the account from the transaction allowance
export const eth_getTransactionCount: MethodHandler<WalletContext, typeof paramsSchema> = {
    name: 'eth_getTransactionCount',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [address] = params;

        const canCheck = await context.walletAuthorizer.canCheckBalanceOf(address);

        if (!canCheck) {
            throw new ForbiddenRpcError('Can only query transaction count for the allowance wallet address');
        }

        return context.targetRpc.delegate(id, method, params);
    }
};
