// Wallet-specific method handlers
import type { z } from 'zod/v4';
import type { MethodHandler, WalletContext } from '../rpc-service';
import { forbiddenMethod, openToPublic } from './generic-handlers';
import { eth_getBalance } from './wallet-rules/eth_getBalance';
import { eth_getBlockByHash } from './wallet-rules/eth_getBlockByHash';
import { eth_getBlockByNumber } from './wallet-rules/eth_getBlockByNumber';
import { eth_getCode } from './wallet-rules/eth_getCode';
import { eth_getTransactionByHash } from './wallet-rules/eth_getTransactionByHash';
import { eth_getTransactionCount } from './wallet-rules/eth_getTransactionCount';
import { eth_getTransactionReceipt } from './wallet-rules/eth_getTransactionReceipt';
import { eth_sendRawTransaction } from './wallet-rules/eth_sendRawTransaction';

export const walletHandlers: MethodHandler<WalletContext, z.ZodType>[] = [
    // methods that are open to public even in regular rpc routes
    openToPublic('eth_chainId'),
    openToPublic('eth_blockNumber'),
    openToPublic('eth_gasPrice'),

    // validated transaction sending
    eth_sendRawTransaction,

    // filtered/mocked block data
    eth_getBlockByHash, // returns mocked block with matching transaction hash
    eth_getBlockByNumber, // returns mocked block with empty transactions
    eth_getTransactionReceipt, // only returns receipt for matching transaction hash
    eth_getTransactionByHash, // only returns transaction for matching transaction hash

    // balance for allowance address only
    eth_getBalance, // returns real balance only for address from transaction allowance
    eth_getTransactionCount, // returns real nonce only for address from transaction allowance

    // code checking - returns empty for allowance address, dummy for others
    eth_getCode, // returns 0x for allowance address (EOA), 0x60606040 for others (contract)

    // informational method
    openToPublic('web3_clientVersion'),

    // All other methods are forbidden for security
    forbiddenMethod('eth_call'),
    forbiddenMethod('eth_getStorageAt'),
    forbiddenMethod('eth_newFilter'),
    forbiddenMethod('eth_newPendingTransactionFilter'),
    forbiddenMethod('eth_getTransactionByBlockHashAndIndex'),
    forbiddenMethod('eth_getTransactionByBlockNumberAndIndex'),
    forbiddenMethod('eth_accounts'),
    forbiddenMethod('eth_estimateGas'),
    forbiddenMethod('eth_getLogs'),
    forbiddenMethod('eth_feeHistory'),
    forbiddenMethod('eth_maxPriorityFeePerGas'),
    forbiddenMethod('eth_getFilterLogs'),
    forbiddenMethod('eth_getFilterChanges'),
    forbiddenMethod('eth_uninstallFilter'),
    forbiddenMethod('eth_newBlockFilter'),
    forbiddenMethod('eth_getBlockTransactionCountByNumber'),
    forbiddenMethod('eth_getBlockTransactionCountByHash'),
    forbiddenMethod('eth_getBlockReceipts'),
    forbiddenMethod('eth_protocolVersion'),
    forbiddenMethod('eth_syncing'),
    forbiddenMethod('eth_coinbase'),
    forbiddenMethod('eth_getCompilers'),
    forbiddenMethod('eth_hashrate'),
    forbiddenMethod('eth_getUncleCountByBlockHash'),
    forbiddenMethod('eth_getUncleCountByBlockNumber'),
    forbiddenMethod('eth_mining'),
    forbiddenMethod('net_version')
];
