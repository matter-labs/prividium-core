import type { ChainCapabilities } from '@repo/api-kit';

export type ChainSettings = {
    AUTH_METHODS: readonly string[];
    CRYPTO_NATIVE_ADMIN_WALLETS: readonly string[];
    CRYPTO_NATIVE_LOGIN_ALLOWLIST: readonly string[];
    WATCHDOG_WALLETS: readonly string[];
    KNOWN_DEV_WALLETS_ALLOWLIST: readonly string[];
    FAUCET_ENABLED: boolean;
    POLICY_PORT?: number;
    MULTI_ORG_ENABLED: boolean;
    DISCLOSURE_METHODS_ENABLED: boolean;
};

const WALLET_LISTS = [
    'CRYPTO_NATIVE_ADMIN_WALLETS',
    'CRYPTO_NATIVE_LOGIN_ALLOWLIST',
    'WATCHDOG_WALLETS',
    'KNOWN_DEV_WALLETS_ALLOWLIST'
] as const;

export function findUnsupportedSettings(
    chainType: string,
    capabilities: ChainCapabilities,
    env: ChainSettings
): string | undefined {
    const unsupported: string[] = [];
    if (!capabilities.walletSignIn) {
        if (env.AUTH_METHODS.includes('crypto_native')) {
            unsupported.push("AUTH_METHODS 'crypto_native'");
        }
        unsupported.push(...WALLET_LISTS.filter((name) => env[name].length > 0));
    }
    if (!capabilities.faucet && env.FAUCET_ENABLED) {
        unsupported.push('FAUCET_ENABLED');
    }
    // env.ts refuses these first on EVM to keep Besu's messages; this covers other chains.
    if (!capabilities.sequencerCallbacks) {
        if (env.POLICY_PORT !== undefined) {
            unsupported.push('POLICY_PORT');
        }
        if (env.MULTI_ORG_ENABLED) {
            unsupported.push('MULTI_ORG_ENABLED');
        }
    }
    if (!capabilities.disclosureMethods && env.DISCLOSURE_METHODS_ENABLED) {
        unsupported.push('DISCLOSURE_METHODS_ENABLED');
    }
    if (unsupported.length === 0) {
        return undefined;
    }
    return `TARGET_CHAIN_TYPE='${chainType}' does not support ${unsupported.join(', ')}: unset ${unsupported.length === 1 ? 'it' : 'them'}`;
}
