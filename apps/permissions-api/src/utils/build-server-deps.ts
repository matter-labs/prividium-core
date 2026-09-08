import { createRemoteJWKSet } from 'jose';
import { numberToHex } from 'viem';
import { type Env, envHasCryptoNativeAuthMethod, envHasOidcAuthMethod } from '../env';
import type { PrividiumInfo } from '../routes/dot-well-known-routes';
import type { JwtValidationData } from '../services/jwt-validator-service';
import type { SiweConfig } from '../siwe-config';

export type AppDeps = {
    oidcOpts?: JwtValidationData;
    siwe: SiweConfig;
    adminWallets: string[];
    prividiumInfo: PrividiumInfo;
};

export function buildServerDeps(config: Env): AppDeps {
    if (!envHasCryptoNativeAuthMethod(config)) {
        throw new Error('Crypto native authentication method is required');
    }

    const deps: AppDeps = {
        siwe: {
            expirationMs: config.SIWE_EXPIRATION_MS,
            chainId: config.SIWE_CHAIN_ID,
            validDomains: config.SIWE_VALID_DOMAINS,
            hmacSecret: config.SIWE_HMAC_SECRET,
            challengeRateLimitCount: config.SIWE_CHALLENGE_RATE_LIMIT_COUNT,
            challengeRateLimitWindowSeconds: config.SIWE_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS,
            consumedNonceTtlSeconds: config.SIWE_CONSUMED_NONCE_TTL_SECONDS,
            cleanupIntervalSeconds: config.SIWE_CLEANUP_INTERVAL_SECONDS,
            rateLimitBypassIps: config.SIWE_CHALLENGE_RATE_LIMIT_BYPASS_IPS ?? []
        },
        adminWallets: config.CRYPTO_NATIVE_ADMIN_WALLETS,
        prividiumInfo: {
            blockExplorerUrl: config.BLOCK_EXPLORER_URL,
            chainId: numberToHex(config.SIWE_CHAIN_ID),
            chainName: config.CHAIN_NAME,
            baseToken: {
                name: config.NATIVE_TOKEN_NAME,
                symbol: config.NATIVE_TOKEN_SYMBOL,
                decimals: config.NATIVE_TOKEN_DECIMALS,
                l1Address: config.NATIVE_TOKEN_L1_ADDRESS ?? null
            },
            rpcUrl: new URL('/rpc', config.PRIVIDIUM_API_URL).toString(),
            userPanelUrl: config.USER_PANEL_URL,
            version: config.VERSION ?? 'local',
            l1ChainId: numberToHex(config.L1_CHAIN_ID),
            l1ChainName: config.L1_CHAIN_NAME,
            featuredWalletIds: config.FEATURED_WALLET_IDS
        }
    };

    if (envHasOidcAuthMethod(config)) {
        deps.oidcOpts = {
            jwks: createRemoteJWKSet(new URL(config.OIDC_JWKS_URI), { timeoutDuration: 15000 }),
            iss: config.OIDC_JWT_ISSUER,
            aud: config.OIDC_JWT_AUD
        };
    }

    return deps;
}
