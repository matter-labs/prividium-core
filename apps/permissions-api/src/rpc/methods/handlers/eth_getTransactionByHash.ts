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
import { TransactionReceiptSchema } from './eth_getTransactionReceipt';

export const TransactionSchema = z.looseObject({
    hash: hexSchema,
    from: addressSchema,
    to: addressSchema.nullable(),
    input: hexSchema
});
export const TransactionResponseSchema = TransactionSchema.nullable();

export type GetTransactionByHashResponse = z.infer<typeof TransactionResponseSchema>;

export const eth_getTransactionByHash: MethodHandler<AuthorizedRpcContext, AnyParams> = {
    name: 'eth_getTransactionByHash',
    paramsSchema: anyParams,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [hasFullRead, hasRpcMethodPermission, associatedAddresses, transaction, receipt] = await Promise.all([
            context.authorizer.hasFullReadAccess(),
            context.authorizer.hasRpcMethodPermission(method),
            context.authorizer.associatedAddresses(),
            forwardFilteredReadNodeError(() => context.targetRpc.send(id, method, params, TransactionResponseSchema)),
            forwardFilteredReadNodeError(() =>
                context.targetRpc.send(`${id}_receipt`, 'eth_getTransactionReceipt', params, TransactionReceiptSchema)
            )
        ]);

        const orgVisibleAddresses = [transaction?.to, transaction?.from].filter((a): a is Address => !!a);
        const visibleByOrgPermissions = await Promise.all(
            orgVisibleAddresses.map((address) =>
                context.authorizer.hasOrgVisibilityOver(address, true, ['rpc_read_eth_getTransactionByHash'])
            )
        ).then((list) => list.some(Boolean));

        if (visibleByOrgPermissions) {
            return response({ id, result: transaction });
        }

        if (hasFullRead || hasRpcMethodPermission) {
            return response({ id, result: transaction });
        }

        if (!transaction) {
            return response({ id, result: null });
        }

        if (!receipt) {
            return (transaction.to && associatedAddresses.has(transaction.to)) ||
                associatedAddresses.has(transaction.from)
                ? response({ id, result: transaction })
                : response({ id, result: null });
        }

        const filtered = await filterTransactionAndReceipt(
            receipt,
            transaction,
            associatedAddresses,
            context.authorizer
        );

        return response({ id, result: filtered.keep ? filtered.transaction : null });
    }
};
