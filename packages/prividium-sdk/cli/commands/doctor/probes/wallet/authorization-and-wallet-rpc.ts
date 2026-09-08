import { requireForbiddenRpc, requireRpcResult } from '../../clients/rpc.js';
import { authorizeTransactionProbe } from '../../clients/wallet-api.js';
import type { DoctorContext, ProbeOutput } from '../../types.js';
import { formatHexQuantity } from '../../utils.js';

export async function runTransactionAuthorizationProbe(context: DoctorContext, walletAddress: string) {
    const nonce = await requireRpcResult(context.targets!.apiBaseUrl, {
        method: 'eth_getTransactionCount',
        token: context.authState!.token,
        params: [walletAddress, 'latest']
    });
    await authorizeTransactionProbe(
        context.targets!.apiBaseUrl,
        context.authState!.token,
        walletAddress,
        BigInt(nonce)
    );
}

export async function runWalletBalanceProbe(context: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const balance = await requireRpcResult(context.targets!.apiBaseUrl, {
        method: 'eth_getBalance',
        path: context.walletApiPath,
        params: [walletAddress, 'latest']
    });
    return { values: [{ label: 'balance', value: formatHexQuantity(balance), inline: true }] };
}

export async function runWalletEthCallRestrictionProbe(context: DoctorContext, walletAddress: string) {
    await requireForbiddenRpc(context.targets!.apiBaseUrl, {
        method: 'eth_call',
        path: context.walletApiPath,
        params: [{ to: walletAddress }, 'latest']
    });
}

export async function runWalletStorageAtRestrictionProbe(context: DoctorContext, walletAddress: string) {
    await requireForbiddenRpc(context.targets!.apiBaseUrl, {
        method: 'eth_getStorageAt',
        path: context.walletApiPath,
        params: [walletAddress, '0x0', 'latest']
    });
}
