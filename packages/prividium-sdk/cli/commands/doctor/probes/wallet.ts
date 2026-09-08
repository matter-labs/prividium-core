import type { DoctorContext, DoctorProbeDefinition, DoctorStageDefinition } from '../types.js';
import { passed, shortenAddress } from '../utils.js';
import { runAuthBalanceProbe, runAuthNonceProbe } from './wallet/authenticated-rpc.js';
import {
    runTransactionAuthorizationProbe,
    runWalletBalanceProbe,
    runWalletEthCallRestrictionProbe,
    runWalletStorageAtRestrictionProbe
} from './wallet/authorization-and-wallet-rpc.js';

export function createWalletStage(walletAddress: string, index: number, total: number): DoctorStageDefinition {
    const progressSuffix = `${index + 1}/${total}: ${walletAddress}`;

    return {
        id: `wallet:${walletAddress}`,
        title: `Wallet ${index + 1} · ${shortenAddress(walletAddress)}`,
        getProbes: () =>
            [
                {
                    id: `authenticated-balance:${walletAddress}`,
                    label: 'RPC eth_getBalance',
                    progressMessage: `RPC ${progressSuffix}`,
                    run: (ctx: DoctorContext) => runAuthBalanceProbe(ctx, walletAddress)
                },
                {
                    id: `authenticated-nonce:${walletAddress}`,
                    label: 'RPC eth_getTransactionCount',
                    runIf: passed(`authenticated-balance:${walletAddress}`, 'Authenticated balance check failed'),
                    run: (ctx: DoctorContext) => runAuthNonceProbe(ctx, walletAddress)
                },
                {
                    id: `transaction-authorization:${walletAddress}`,
                    label: 'Transaction authorization',
                    progressMessage: `Authorization and Wallet RPC ${progressSuffix}`,
                    runIf: passed('wallet-api-token', 'Wallet API not available'),
                    run: (ctx: DoctorContext) => runTransactionAuthorizationProbe(ctx, walletAddress)
                },
                {
                    id: `wallet-balance:${walletAddress}`,
                    label: 'Wallet RPC eth_getBalance',
                    runIf: passed(`transaction-authorization:${walletAddress}`, 'Transaction authorization failed'),
                    run: (ctx: DoctorContext) => runWalletBalanceProbe(ctx, walletAddress)
                },
                {
                    id: `wallet-eth-call-restricted:${walletAddress}`,
                    label: 'Wallet RPC eth_call restriction',
                    runIf: passed(`wallet-balance:${walletAddress}`, 'Wallet balance check failed'),
                    run: (ctx: DoctorContext) => runWalletEthCallRestrictionProbe(ctx, walletAddress)
                },
                {
                    id: `wallet-eth-get-storage-at-restricted:${walletAddress}`,
                    label: 'Wallet RPC eth_getStorageAt restriction',
                    runIf: passed(`wallet-balance:${walletAddress}`, 'Wallet balance check failed'),
                    run: (ctx: DoctorContext) => runWalletStorageAtRestrictionProbe(ctx, walletAddress)
                }
            ] satisfies DoctorProbeDefinition[]
    };
}
