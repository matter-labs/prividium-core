import type { Address } from 'viem';
import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { forwardFilteredReadNodeError } from '../../filtered-read-error';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { filterTransactionAndReceipt } from '../generic-handlers/filter-associated-transactions';

export const TransactionReceiptSchema = z
    .looseObject({
        transactionHash: hexSchema,
        from: addressSchema,
        to: addressSchema.nullable(),
        logs: z.array(
            z.looseObject({
                address: hexSchema,
                topics: z.array(hexSchema)
            })
        )
    })
    .nullable();

export type GetTransactionReceiptsResponse = z.infer<typeof TransactionReceiptSchema>;

export const eth_getTransactionReceipt: MethodHandler<AuthorizedRpcContext, AnyParams> = {
    name: 'eth_getTransactionReceipt',
    paramsSchema: anyParams,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [hasFullRead, hasRpcMethodPermission, associatedAddresses, receipt] = await Promise.all([
            context.authorizer.hasFullReadAccess(),
            context.authorizer.hasRpcMethodPermission(method),
            context.authorizer.associatedAddresses(),
            forwardFilteredReadNodeError(() => context.targetRpc.send(id, method, params, TransactionReceiptSchema))
        ]);

        const orgVisibleAddresses = [receipt?.to, receipt?.from].filter((a): a is Address => !!a);
        const visibleByOrgPermissions = await Promise.all(
            orgVisibleAddresses.map((a) =>
                context.authorizer.hasOrgVisibilityOver(a, true, ['rpc_read_eth_getTransactionReceipt'])
            )
        ).then((list) => list.some(Boolean));

        if (visibleByOrgPermissions) {
            return response({ id, result: receipt });
        }

        if (hasFullRead || hasRpcMethodPermission) {
            return response({ id, result: receipt });
        }

        if (!receipt) {
            return response({ id, result: null });
        }

        const isAssociated = await filterTransactionAndReceipt(receipt, null, associatedAddresses, context.authorizer);

        return response({ id, result: isAssociated.keep ? isAssociated.receipt : null });
    }
};
