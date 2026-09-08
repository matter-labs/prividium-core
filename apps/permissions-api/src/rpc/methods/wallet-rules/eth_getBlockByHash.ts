import { ZERO_LOGS_BLOOM } from '../../constants';
import { type JsonRpcResponse, response } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { MethodHandler, WalletContext } from '../../rpc-service';

// Handler for getBlockByHash that returns a mocked block with only the filtered transaction hash
export const eth_getBlockByHash: MethodHandler<WalletContext, AnyParams> = {
    name: 'eth_getBlockByHash',
    paramsSchema: anyParams,
    handle(_context, _method, _params, id): Promise<JsonRpcResponse> {
        return Promise.resolve(
            response({
                id,
                result: {
                    // Mocked block fields
                    number: '0x0',
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
                    // Collection with allowed transaction or nothing.
                    transactions: []
                }
            })
        );
    }
};
