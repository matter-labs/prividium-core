import { z } from 'zod';

export async function fetchWalletRpcToken(apiBaseUrl: string, token: string): Promise<{ token: string }> {
    const response = await fetch(new URL('/api/wallet/personal-rpc-token', apiBaseUrl), {
        headers: {
            authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(body.trim().length > 0 ? `HTTP ${response.status}: ${body.trim()}` : `HTTP ${response.status}`);
    }

    return z.object({ token: z.string() }).parse(await response.json());
}

export async function authorizeTransactionProbe(
    apiBaseUrl: string,
    token: string,
    walletAddress: string,
    nonce: bigint
): Promise<{ activeUntil: string; message: string }> {
    const response = await fetch(new URL('/api/wallet/transaction-authorization', apiBaseUrl), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            walletAddress,
            nonce: Number(nonce),
            toAddress: walletAddress,
            value: '1'
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(body.trim().length > 0 ? `HTTP ${response.status}: ${body.trim()}` : `HTTP ${response.status}`);
    }

    return z
        .object({
            message: z.string(),
            activeUntil: z.string()
        })
        .parse(await response.json());
}
