import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { buildServerDeps } from './build-server-deps';
import { encryptToFile } from './crypto';

vi.mock('jose', () => ({
    createRemoteJWKSet: vi.fn().mockReturnValue('remote-jwks'),
    createLocalJWKSet: vi.fn().mockReturnValue('local-jwks'),
    importJWK: vi.fn().mockResolvedValue({ type: 'private' })
}));

// Minimum env fields required to build the well-known file dependency.
const WELL_KNOWN_CONFIG = {
    PRIVIDIUM_API_URL: 'http://localhost:8000',
    CHAIN_NAME: 'test-chain',
    NATIVE_TOKEN_NAME: 'Ether',
    NATIVE_TOKEN_SYMBOL: 'ETH',
    NATIVE_TOKEN_DECIMALS: 18,
    BLOCK_EXPLORER_URL: 'http://localhost:3010',
    USER_PANEL_URL: 'http://localhost:3001',
    L1_CHAIN_ID: 31337,
    L1_CHAIN_NAME: 'Anvil Localhost'
};

describe('buildServerDeps', () => {
    let encryptionKey: Buffer;
    let encryptedJwkPath: string;

    beforeEach(() => {
        vi.clearAllMocks();

        encryptionKey = randomBytes(32);
        const testJwk = {
            kty: 'RSA',
            n: 'test-n-value',
            e: 'AQAB',
            d: 'test-d-value',
            p: 'test-p-value',
            q: 'test-q-value',
            dp: 'test-dp-value',
            dq: 'test-dq-value',
            qi: 'test-qi-value',
            alg: 'RS256'
        };
        encryptedJwkPath = join(tmpdir(), `encrypted-jwk-${Date.now()}.txt`);
        encryptToFile(Buffer.from(JSON.stringify(testJwk)), encryptionKey, encryptedJwkPath);
    });

    afterEach(() => {
        rmSync(encryptedJwkPath, { recursive: true, force: true });
    });

    it('should throw error when no auth methods configured', () => {
        const config = {
            SIWE_CHAIN_ID: 1,
            SIWE_EXPIRATION_MS: 3600000,
            AUTH_METHODS: []
        } as unknown as Env;

        expect(() => buildServerDeps(config)).toThrow('Crypto native authentication method is required');
    });

    it('should throw error when only OIDC auth is configured', () => {
        const config = {
            SIWE_CHAIN_ID: 1,
            SIWE_EXPIRATION_MS: 3600000,
            AUTH_METHODS: ['oidc'],
            OIDC_JWKS_URI: 'https://example.okta.com/oauth2/default/v1/keys',
            OIDC_JWT_ISSUER: 'https://example.okta.com/oauth2/default',
            OIDC_JWT_AUD: 'api://default'
        } as Env;

        expect(() => buildServerDeps(config)).toThrow('Crypto native authentication method is required');
    });

    it('should build deps with crypto native auth when configured', () => {
        const config = {
            ...WELL_KNOWN_CONFIG,
            SIWE_CHAIN_ID: 1,
            SIWE_EXPIRATION_MS: 3600000,
            SIWE_CHALLENGE_RATE_LIMIT_COUNT: 10,
            SIWE_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS: 300,
            SIWE_CONSUMED_NONCE_TTL_SECONDS: 600,
            SIWE_CLEANUP_INTERVAL_SECONDS: 60,
            AUTH_METHODS: ['crypto_native']
        } as Env;

        const deps = buildServerDeps(config);

        expect(deps.siwe).toBeDefined();
        expect(deps.siwe.hmacSecret).toBeUndefined();
        expect(deps.siwe.challengeRateLimitCount).toBe(10);
        expect(deps.siwe.challengeRateLimitWindowSeconds).toBe(300);
        expect(deps.siwe.consumedNonceTtlSeconds).toBe(600);
        expect(deps.siwe.cleanupIntervalSeconds).toBe(60);
        expect(deps.siwe.rateLimitBypassIps).toEqual([]);

        expect(deps.oidcOpts).toBeUndefined();
    });

    it('should pass SIWE_HMAC_SECRET when configured', () => {
        const config = {
            ...WELL_KNOWN_CONFIG,
            SIWE_CHAIN_ID: 1,
            SIWE_EXPIRATION_MS: 3600000,
            SIWE_HMAC_SECRET: '444556204f4e4c5920686d61632073656372657420646f206e6f742075736521',
            AUTH_METHODS: ['crypto_native']
        } as Env;

        const deps = buildServerDeps(config);
        expect(deps.siwe.hmacSecret).toBe(config.SIWE_HMAC_SECRET);
    });

    it('should build deps with both auth methods when both configured', () => {
        const config = {
            ...WELL_KNOWN_CONFIG,
            SIWE_CHAIN_ID: 1,
            SIWE_EXPIRATION_MS: 3600000,
            AUTH_METHODS: ['oidc', 'crypto_native'],
            OIDC_JWKS_URI: 'https://example.okta.com/oauth2/default/v1/keys',
            OIDC_JWT_ISSUER: 'https://example.okta.com/oauth2/default',
            OIDC_JWT_AUD: 'api://default'
        } as Env;

        const deps = buildServerDeps(config);

        expect(deps.siwe).toBeDefined();
        expect(deps.oidcOpts).toBeDefined();
        expect(deps.oidcOpts?.iss).toBe(config.OIDC_JWT_ISSUER);
        expect(deps.oidcOpts?.aud).toBe(config.OIDC_JWT_AUD);
        expect(deps.oidcOpts?.jwks).toBe('remote-jwks');
    });
});
