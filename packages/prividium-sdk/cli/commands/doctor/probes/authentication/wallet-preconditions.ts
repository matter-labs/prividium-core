import type { DoctorContext, ProbeOutput } from '../../types.js';

export async function runWalletPreconditionsProbe(context: DoctorContext): Promise<ProbeOutput> {
    const walletAddresses = context.authState!.profile.wallets.map((wallet) => wallet.walletAddress);
    context.walletAddresses = walletAddresses;

    if (walletAddresses.length === 0) {
        return { status: 'warn', details: ['No associated wallets'] };
    }

    return { values: [{ label: 'walletCount', value: `wallets: ${String(walletAddresses.length)}`, inline: true }] };
}
