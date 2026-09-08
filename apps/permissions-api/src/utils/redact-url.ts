const WALLET_TOKEN_PATTERN = /\/rpc\/wallet\/[^/?#]+/g;

export function redactSensitiveUrl(url: string): string {
    return url.replace(WALLET_TOKEN_PATTERN, '/rpc/wallet/[REDACTED]');
}
