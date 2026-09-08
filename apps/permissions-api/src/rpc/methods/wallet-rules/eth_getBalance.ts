import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import type { MethodHandler, WalletContext } from '../../rpc-service';

const paramsSchema = z.tuple([addressSchema], z.unknown());

// Handler for getBalance that returns real balance only for the account from the transaction allowance
export const eth_getBalance: MethodHandler<WalletContext, typeof paramsSchema> = {
    name: 'eth_getBalance',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [address] = params;

        const canCheck = await context.walletAuthorizer.canCheckBalanceOf(address);

        if (!canCheck) {
            throw new ForbiddenRpcError('Can only query balance for the allowance wallet address');
        }

        // Address matches, get real balance from target RPC
        return context.targetRpc.delegate(id, method, params);
    }
};
