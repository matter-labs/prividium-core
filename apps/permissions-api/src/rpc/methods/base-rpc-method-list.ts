import type { Address } from 'viem';
import type { z } from 'zod/v4';
import { methodAccessSchema } from '../../db/schema';
import type { AuthorizedRpcContext, MethodHandler } from '../rpc-service';
import {
    forbiddenMethod,
    openToPublic,
    requireFullReadAccess,
    unrestricted,
    validatedEthereumCall
} from './generic-handlers';
import { checkAddressOrContractOwnership } from './generic-handlers/check-address-or-contract-ownership';
import { requireDeployPermission } from './generic-handlers/require-deploy-permission';
import {
    eth_getBlockByHash,
    eth_getBlockByNumber,
    eth_getBlockReceipts,
    eth_getBlockTransactionCountByHash,
    eth_getBlockTransactionCountByNumber,
    eth_getLogs,
    eth_getTransactionByHash,
    eth_getTransactionReceipt,
    eth_sendRawTransaction
} from './handlers';
import { bundlerHandlers } from './handlers/bundler';
import { prividium_accountDataDisclosure } from './handlers/prividium_accountDataDisclosure';
import { prividium_storageDisclosureContract } from './handlers/prividium_storageDisclosureContract';
import { prividium_tokenBalanceDisclosure } from './handlers/prividium_tokenBalanceDisclosure';
import { prividium_tokenSupplyDisclosure } from './handlers/prividium_tokenSupplyDisclosure';

export function createBaseRpcMethodList(
    publicCodeAddresses: Address[] = [],
    disclosureMethodsEnabled: boolean
): MethodHandler<AuthorizedRpcContext, z.ZodType>[] {
    return [
        /* ─────────────────────────────
           Debug namespace (exact order)
           ───────────────────────────── */
        forbiddenMethod('debug_getRawHeader'),
        forbiddenMethod('debug_getRawBlock'),
        forbiddenMethod('debug_getRawTransaction'),
        forbiddenMethod('debug_getRawTransactions'),
        forbiddenMethod('debug_getRawReceipts'),
        forbiddenMethod('debug_traceBlock'),
        forbiddenMethod('debug_traceBlockByHash'),
        forbiddenMethod('debug_traceBlockByNumber'),
        forbiddenMethod('debug_traceTransaction'),
        forbiddenMethod('debug_traceCall'),
        forbiddenMethod('debug_traceCallMany'),
        forbiddenMethod('debug_chainConfig'),
        forbiddenMethod('debug_codeByHash'),

        /* ─────────────────────────────
       Eth namespace (exact order)
       ───────────────────────────── */
        unrestricted('eth_protocolVersion'),
        unrestricted('eth_syncing'),
        unrestricted('eth_coinbase'),
        forbiddenMethod('eth_accounts'),
        openToPublic('eth_blockNumber'),
        openToPublic('eth_chainId'),
        eth_getBlockByHash,
        eth_getBlockByNumber,
        eth_getBlockTransactionCountByHash,
        eth_getBlockTransactionCountByNumber,
        forbiddenMethod('eth_getUncleCountByBlockHash'),
        forbiddenMethod('eth_getUncleCountByBlockNumber'),
        forbiddenMethod('eth_getUncleByBlockHashAndIndex'),
        forbiddenMethod('eth_getUncleByBlockNumberAndIndex'),
        forbiddenMethod('eth_getRawTransactionByHash'), // TODO apply same logic than eth_getTransactionByHash
        eth_getTransactionByHash,
        eth_getBlockReceipts,
        forbiddenMethod('eth_getRawTransactionByBlockHashAndIndex'), // TODO apply same logic than eth_getTransactionByHash
        forbiddenMethod('eth_getTransactionByBlockHashAndIndex'), // TODO apply same logic than eth_getTransactionByHash
        forbiddenMethod('eth_getRawTransactionByBlockNumberAndIndex'), // TODO apply same logic than eth_getTransactionByHash
        forbiddenMethod('eth_getTransactionByBlockNumberAndIndex'), // TODO apply same logic than eth_getTransactionByHash
        forbiddenMethod('eth_getTransactionBySenderAndNonce'), // TODO apply same logic than eth_getTransactionByHash
        eth_getTransactionReceipt,
        checkAddressOrContractOwnership('eth_getBalance', publicCodeAddresses, '0x00'),
        forbiddenMethod('eth_getStorageAt'),
        checkAddressOrContractOwnership('eth_getTransactionCount', publicCodeAddresses, '0x00'),
        checkAddressOrContractOwnership('eth_getCode', publicCodeAddresses),
        forbiddenMethod('eth_getHeaderByNumber'),
        forbiddenMethod('eth_getHeaderByHash'),
        forbiddenMethod('eth_simulateV1'),
        validatedEthereumCall('eth_call', 2, methodAccessSchema.enum.read),
        forbiddenMethod('eth_callMany'), // TODO apply same logic than eth_call
        forbiddenMethod('eth_createAccessList'),
        validatedEthereumCall('eth_estimateGas', 2, methodAccessSchema.enum.write),
        openToPublic('eth_gasPrice'),
        forbiddenMethod('eth_getAccount'),
        unrestricted('eth_maxPriorityFeePerGas'),
        forbiddenMethod('eth_blobBaseFee'),
        requireDeployPermission('eth_feeHistory'),
        forbiddenMethod('eth_sendTransaction'),
        eth_sendRawTransaction,
        forbiddenMethod('eth_sendRawTransactionSync'),
        forbiddenMethod('eth_sign'),
        forbiddenMethod('eth_signTransaction'),
        forbiddenMethod('eth_signTypedData'),
        forbiddenMethod('eth_getProof'),
        // This method currently returns "not implemented" from ZKsyncOS, so we forbid it in case it is implemented in the future
        forbiddenMethod('eth_getAccountInfo'),

        requireFullReadAccess('eth_newFilter'),
        requireFullReadAccess('eth_newBlockFilter'),
        forbiddenMethod('eth_newPendingTransactionFilter'),
        requireFullReadAccess('eth_getFilterChanges'),
        requireFullReadAccess('eth_getFilterLogs'),
        requireFullReadAccess('eth_uninstallFilter'),
        eth_getLogs,
        forbiddenMethod('eth_subscribe'),
        forbiddenMethod('eth_unsubscribe'),

        /* ─────────────────────────────
           net namespace
           ───────────────────────────── */
        openToPublic('net_version'),

        /* ─────────────────────────────
           ots namespace
           ───────────────────────────── */
        forbiddenMethod('ots_getHeaderByNumber'),
        forbiddenMethod('ots_hasCode'),
        forbiddenMethod('ots_getApiLevel'),
        forbiddenMethod('ots_getInternalOperations'),
        forbiddenMethod('ots_getTransactionError'),
        forbiddenMethod('ots_traceTransaction'),
        forbiddenMethod('ots_getBlockDetails'),
        forbiddenMethod('ots_getBlockDetailsByHash'),
        forbiddenMethod('ots_getBlockTransactions'),
        forbiddenMethod('ots_searchTransactionsBefore'),
        forbiddenMethod('ots_searchTransactionsAfter'),
        forbiddenMethod('ots_getTransactionBySenderAndNonce'),
        forbiddenMethod('ots_getContractCreator'),

        /* ─────────────────────────────
           web3 namespace
           ───────────────────────────── */
        openToPublic('web3_clientVersion'),
        forbiddenMethod('web3_sha3'),

        /* ─────────────────────────────
           txpool namespace
           ───────────────────────────── */
        forbiddenMethod('txpool_inspect'),
        forbiddenMethod('txpool_content'),
        forbiddenMethod('txpool_status'),

        /* ─────────────────────────────
           unstable namespace
           ───────────────────────────── */
        forbiddenMethod('unstable_getBatchByBlockNumber'),
        forbiddenMethod('unstable_getLocalRoot'),

        /* ─────────────────────────────
           Zks namespace (exact order)
           ───────────────────────────── */
        forbiddenMethod('zks_getBridgeContracts'),
        forbiddenMethod('zks_getBytecodeSupplierContract'),
        unrestricted('zks_getBridgehubContract'),
        unrestricted('zks_getL2ToL1LogProof'),
        unrestricted('zks_getGenesis'),
        forbiddenMethod('zks_getBlockMetadataByNumber'),
        forbiddenMethod('zks_getProof'),

        /* ─────────────────────────────
           prividium namespace
           ───────────────────────────── */
        ...(disclosureMethodsEnabled
            ? [
                  prividium_storageDisclosureContract,
                  prividium_tokenSupplyDisclosure,
                  prividium_tokenBalanceDisclosure,
                  prividium_accountDataDisclosure
              ]
            : []),

        /* ─────────────────────────────
           bundlerMethods
           ───────────────────────────── */
        ...bundlerHandlers
    ];
}
