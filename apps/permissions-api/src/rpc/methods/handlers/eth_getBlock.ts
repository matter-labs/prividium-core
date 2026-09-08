import { numberToHex } from 'viem';
import { z } from 'zod/v4';
import { blockTagSchema } from '../../../utils/schemas/block-tag';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { ZERO_LOGS_BLOOM } from '../../constants';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import type { Authorizer } from '../../permissions';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import type { ExternalRpc } from '../../target-rpc';
import { filterTransactionAndReceipt, participantAddresses } from '../generic-handlers/filter-associated-transactions';
import { BlockReceiptsSchema, type GetBlockReceiptsResponse } from './eth_getBlockReceipts';
import { TransactionSchema } from './eth_getTransactionByHash';

const responseSchema = z.looseObject({
    number: hexSchema,
    transactions: z.array(z.union([hexSchema, TransactionSchema]))
});

const fullBlockSchema = z.looseObject({
    number: hexSchema,
    transactions: z.array(TransactionSchema)
});

async function fetchBlockAndFilterTransactions(
    id: string | number,
    targetRpc: ExternalRpc,
    block: z.infer<typeof responseSchema>,
    authorizer: Authorizer
): Promise<z.infer<typeof responseSchema>> {
    const receipts = await targetRpc.send(
        `${id}_getBlockReceipts`,
        'eth_getBlockReceipts',
        [block.number],
        BlockReceiptsSchema.nullable()
    );

    if (receipts === null) {
        throw new Error(`Inconsistency: Asking for recepients of non existing block ${block.number}`);
    }

    const receiptsMap: Record<GetBlockReceiptsResponse[number]['transactionHash'], GetBlockReceiptsResponse[number]> =
        {};
    for (const receipt of receipts) {
        receiptsMap[receipt.transactionHash] = receipt;
    }

    const associatedAddresses = await authorizer.visibleAddressesAmong(participantAddresses(receipts));

    const filtered = await Promise.all(
        block.transactions.map((tx) =>
            filterTransactionAndReceipt(
                receiptsMap[typeof tx === 'string' ? tx : tx.hash]!,
                tx,
                associatedAddresses,
                authorizer
            )
        )
    ).then((res) => res.filter((a) => a.keep).map((a) => a.transaction));

    return {
        ...block,
        logsBloom: ZERO_LOGS_BLOOM,
        transactions: filtered
    };
}

const filterBlock = async (context: AuthorizedRpcContext, method: string, params: unknown[], id: number | string) => {
    await context.authorizer.assertCanFilterTransactions();

    const [hasFullRead, hasRpcMethodPermission, block] = await Promise.all([
        context.authorizer.hasFullReadAccess(),
        context.authorizer.hasRpcMethodPermission(method),
        context.targetRpc.send(id, method, params, responseSchema.nullable())
    ]);

    if (hasFullRead || hasRpcMethodPermission) {
        return response({ id, result: block });
    }

    if (block === null) {
        return response({ id, result: null });
    }

    const result = await fetchBlockAndFilterTransactions(id, context.targetRpc, block, context.authorizer);

    return response({ id, result });
};

const blockByNumberParamsSchema = z.tuple([blockTagSchema, z.boolean()]);
const blockByHashParamsSchema = z.tuple([hexSchema, z.boolean()]);
const blockTransactionCountByNumberParamsSchema = z.tuple([blockTagSchema]);
const blockTransactionCountByHashParamsSchema = z.tuple([hexSchema]);

const filterPendingBlock = async (
    context: AuthorizedRpcContext,
    method: string,
    rpcArgs: z.infer<typeof blockByNumberParamsSchema>,
    id: number | string
) => {
    const [blockTag, fullTxs] = rpcArgs;

    await context.authorizer.assertCanFilterTransactions();

    const [hasFullRead, hasRpcMethodPermission, block] = await Promise.all([
        context.authorizer.hasFullReadAccess(),
        context.authorizer.hasRpcMethodPermission(method),
        context.targetRpc.send(id, method, [blockTag, true], fullBlockSchema.nullable())
    ]);

    if (block === null) {
        return response({ id, result: null });
    }

    if (hasFullRead || hasRpcMethodPermission) {
        const result = {
            ...block,
            transactions: fullTxs ? block.transactions : block.transactions.map((tx) => tx.hash)
        };
        return response({ id, result });
    }

    const addresses = await context.authorizer.visibleAddressesAmong(participantAddresses(block.transactions));
    const filtered = block.transactions.filter((tx) => {
        return addresses.has(tx.from) || !!(tx.to && addresses.has(tx.to));
    });

    const result = {
        ...block,
        logsBloom: ZERO_LOGS_BLOOM,
        transactions: fullTxs ? filtered : filtered.map((tx) => tx.hash)
    };

    return response({ id, result });
};

export const eth_getBlockByNumber: MethodHandler<AuthorizedRpcContext, typeof blockByNumberParamsSchema> = {
    name: 'eth_getBlockByNumber',
    paramsSchema: blockByNumberParamsSchema,
    async handle(context, method, params, id) {
        const [blockIdentifier] = params;

        if (blockIdentifier === 'pending') {
            return filterPendingBlock(context, method, params, id);
        }

        return filterBlock(context, method, params, id);
    }
};

export const eth_getBlockByHash: MethodHandler<AuthorizedRpcContext, typeof blockByHashParamsSchema> = {
    name: 'eth_getBlockByHash',
    paramsSchema: blockByHashParamsSchema,
    handle: filterBlock
};

export const eth_getBlockTransactionCountByNumber: MethodHandler<
    AuthorizedRpcContext,
    typeof blockTransactionCountByNumberParamsSchema
> = {
    name: 'eth_getBlockTransactionCountByNumber',
    paramsSchema: blockTransactionCountByNumberParamsSchema,
    async handle(
        context: AuthorizedRpcContext,
        _method: string,
        params: unknown[],
        id: number | string
    ): Promise<JsonRpcResponse> {
        await context.authorizer.assertCanFilterTransactions();

        const [hasFullRead, block] = await Promise.all([
            context.authorizer.hasFullReadAccess(),
            context.targetRpc.send(
                `${id}_getBlockByNumber`,
                'eth_getBlockByNumber',
                [params[0], true],
                fullBlockSchema.nullable()
            )
        ]);

        if (block === null) {
            return response({ id, result: null });
        }

        if (hasFullRead) {
            return response({ id, result: numberToHex(block.transactions.length) });
        }

        if (params[0] === 'pending') {
            const addresses = await context.authorizer.visibleAddressesAmong(participantAddresses(block.transactions));
            return response({
                id,
                result: numberToHex(
                    block.transactions.filter((tx) => addresses.has(tx.from) || (tx.to && addresses.has(tx.to))).length
                )
            });
        }

        const filteredBlock = await fetchBlockAndFilterTransactions(id, context.targetRpc, block, context.authorizer);
        return response({
            id,
            result: numberToHex(filteredBlock.transactions.length)
        });
    }
};

export const eth_getBlockTransactionCountByHash: MethodHandler<
    AuthorizedRpcContext,
    typeof blockTransactionCountByHashParamsSchema
> = {
    name: 'eth_getBlockTransactionCountByHash',
    paramsSchema: blockTransactionCountByHashParamsSchema,
    async handle(
        context: AuthorizedRpcContext,
        _method: string,
        params: unknown[],
        id: number | string
    ): Promise<JsonRpcResponse> {
        await context.authorizer.assertCanFilterTransactions();

        const [hasFullRead, block] = await Promise.all([
            context.authorizer.hasFullReadAccess(),
            context.targetRpc.send(
                `${id}_getBlockByHash`,
                'eth_getBlockByHash',
                [params[0], false],
                responseSchema.nullable()
            )
        ]);

        if (block === null) {
            return response({ id, result: null });
        }

        if (hasFullRead) {
            return response({ id, result: numberToHex(block.transactions.length) });
        }

        const result = await fetchBlockAndFilterTransactions(id, context.targetRpc, block, context.authorizer);
        return response({ id, result: numberToHex(result.transactions.length) });
    }
};
