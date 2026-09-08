import { z } from 'zod/v4';
import { forwardFilteredReadNodeError } from '../../filtered-read-error';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { filterTransactionAndReceipt, participantAddresses } from '../generic-handlers/filter-associated-transactions';
import { TransactionReceiptSchema } from './eth_getTransactionReceipt';

export const BlockReceiptsSchema = z.array(TransactionReceiptSchema.unwrap()); // Schema is nullable so we need to unwrap it

export type GetBlockReceiptsResponse = z.infer<typeof BlockReceiptsSchema>;

export const eth_getBlockReceipts: MethodHandler<AuthorizedRpcContext, AnyParams> = {
    name: 'eth_getBlockReceipts',
    paramsSchema: anyParams,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        await context.authorizer.assertCanFilterTransactions();

        const [hasFullRead, blockReceipts] = await Promise.all([
            context.authorizer.hasFullReadAccess(),
            forwardFilteredReadNodeError(() =>
                context.targetRpc.send(id, method, params, BlockReceiptsSchema.nullable())
            )
        ]);

        if (hasFullRead) {
            return response({ id, result: blockReceipts });
        }

        if (blockReceipts === null) {
            return response({ id, result: null });
        }

        const associatedAddresses = await context.authorizer.visibleAddressesAmong(participantAddresses(blockReceipts));

        const middleStep = await Promise.all(
            blockReceipts.map((r) => filterTransactionAndReceipt(r, null, associatedAddresses, context.authorizer))
        );

        const res = middleStep.filter((t) => t.keep).map((t) => t.receipt);

        return response({ id, result: res });
    }
};
