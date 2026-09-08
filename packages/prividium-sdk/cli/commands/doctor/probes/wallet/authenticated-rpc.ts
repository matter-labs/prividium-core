import { requireRpcResult } from '../../clients/rpc.js';
import type { DoctorContext, ProbeOutput } from '../../types.js';
import { formatHexQuantity } from '../../utils.js';

export async function runAuthBalanceProbe(context: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const balance = await requireRpcResult(context.targets!.apiBaseUrl, {
        method: 'eth_getBalance',
        token: context.authState!.token,
        params: [walletAddress, 'latest']
    });
    return { values: [{ label: 'balance', value: formatHexQuantity(balance), inline: true }] };
}

export async function runAuthNonceProbe(context: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const nonce = await requireRpcResult(context.targets!.apiBaseUrl, {
        method: 'eth_getTransactionCount',
        token: context.authState!.token,
        params: [walletAddress, 'latest']
    });
    return { values: [{ label: 'nonce', value: formatHexQuantity(nonce), inline: true }] };
}
