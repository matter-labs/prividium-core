import { z } from 'zod/v4';
import { ZERO_LOGS_BLOOM } from '../../constants';
import { type JsonRpcResponse, response } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { MethodHandler, WalletContext } from '../../rpc-service';

const blockSchema = z.looseObject({
    number: z.string().optional(),
    baseFeePerGas: z.string().optional()
});

export const eth_getBlockByNumber: MethodHandler<WalletContext, AnyParams> = {
    name: 'eth_getBlockByNumber',
    paramsSchema: anyParams,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const blockResponse = await context.targetRpc.delegate(id, method, params);

        if ('error' in blockResponse || !blockResponse.result) {
            return blockResponse;
        }

        const realBlock = blockSchema.parse(blockResponse.result);
        const blockNumber = realBlock.number || '0x0';

        return response({
            id,
            result: {
                number: blockNumber,
                hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                nonce: '0x0000000000000000',
                sha3Uncles: '0x0000000000000000000000000000000000000000000000000000000000000000',
                logsBloom: ZERO_LOGS_BLOOM,
                transactionsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
                stateRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
                receiptsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
                miner: '0x0000000000000000000000000000000000000000',
                difficulty: '0x0',
                totalDifficulty: '0x0',
                extraData: '0x',
                size: '0x0',
                gasLimit: '0x0',
                gasUsed: '0x0',
                timestamp: '0x0',
                uncles: [],
                // Always empty transactions for privacy
                transactions: [],
                // Only field passed through — wallets read baseFeePerGas to detect EIP-1559 (else they reject type-2 txs).
                ...(realBlock.baseFeePerGas != null ? { baseFeePerGas: realBlock.baseFeePerGas } : {})
            }
        });
    }
};
