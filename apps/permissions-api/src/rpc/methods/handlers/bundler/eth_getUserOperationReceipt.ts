import { z } from 'zod/v4';
import { addressSchema } from '../../../../utils/schemas/address';
import { hexSchema } from '../../../../utils/schemas/hex-schema';
import { ZERO_LOGS_BLOOM } from '../../../constants';
import type { JsonRpcResponse } from '../../../json-rpc';
import { response } from '../../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../../rpc-service';
import { isBundlerContext } from './utils/is-bundler-context';

// ERC-4337 eth_getUserOperationReceipt response schema
// Contains the sender address for access control
const UserOperationReceiptResponseSchema = z
    .looseObject({
        sender: addressSchema
    })
    .nullable();

const paramsSchema = z.tuple([hexSchema], z.unknown());

export const eth_getUserOperationReceipt: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'eth_getUserOperationReceipt',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        // 0. Ensure bundler is enabled
        isBundlerContext(context);

        // 1. Fetch UserOperation receipt and associated addresses in parallel
        const [associatedAddresses, receipt] = await Promise.all([
            context.authorizer.associatedAddresses(),
            context.bundlerRpc.send(id, method, params, UserOperationReceiptResponseSchema)
        ]);

        // 2. If not found, return null
        if (!receipt) {
            return response({ id, result: null });
        }

        // 3. Check if sender is associated with the user
        const isAssociated = associatedAddresses.has(receipt.sender);

        return response({ id, result: isAssociated ? { ...receipt, logsBloom: ZERO_LOGS_BLOOM } : null });
    }
};
