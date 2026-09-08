import { requireRpcResult } from '../clients/rpc.js';
import { fetchWalletRpcToken } from '../clients/wallet-api.js';
import type { DoctorContext, DoctorStageDefinition } from '../types.js';
import { formatHexQuantity, passed } from '../utils.js';

export const walletApiStage: DoctorStageDefinition = {
    id: 'wallet-api',
    title: 'Wallet API',
    getProbes: () => [
        {
            id: 'wallet-api-token',
            label: 'Wallet API token',
            progressMessage: 'Requesting personal wallet RPC token',
            runIf: passed('profile-fetch', 'Authentication not completed'),
            run: async (context: DoctorContext) => {
                const { token } = await fetchWalletRpcToken(context.targets!.apiBaseUrl, context.authState!.token);
                context.walletApiAvailable = true;
                context.walletApiPath = `/rpc/wallet/${token}`;
            }
        },
        {
            id: 'wallet-rpc-chain-id',
            label: 'Wallet RPC eth_chainId',
            runIf: passed('wallet-api-token', 'Wallet API token not available'),
            run: async (context: DoctorContext) => {
                const chainId = await requireRpcResult(context.targets!.apiBaseUrl, {
                    method: 'eth_chainId',
                    path: context.walletApiPath!
                });
                return {
                    values: [{ label: 'blockNumber', value: formatHexQuantity(chainId), inline: true }]
                };
            }
        },
        {
            id: 'wallet-rpc-block-number',
            label: 'Wallet RPC eth_blockNumber',
            runIf: passed('wallet-api-token', 'Wallet API token not available'),
            run: async (context: DoctorContext) => {
                const blockNumber = await requireRpcResult(context.targets!.apiBaseUrl, {
                    method: 'eth_blockNumber',
                    path: context.walletApiPath!
                });

                return {
                    values: [{ label: 'blockNumber', value: formatHexQuantity(blockNumber), inline: true }]
                };
            }
        }
    ]
};
