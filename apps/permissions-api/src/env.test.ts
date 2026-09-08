import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    findTargetChainTypeConflict,
    loadEnv,
    shouldRequirePolicyAuthToken,
    shouldRequirePolicyListener,
    shouldRequireSiweHmacSecret
} from './env';

describe('shouldRequireSiweHmacSecret', () => {
    it('returns true when AUTH_METHODS includes crypto_native', () => {
        expect(shouldRequireSiweHmacSecret({ AUTH_METHODS: ['crypto_native'] })).toBe(true);
        expect(shouldRequireSiweHmacSecret({ AUTH_METHODS: ['oidc', 'crypto_native'] })).toBe(true);
    });

    it('returns false when AUTH_METHODS does not include crypto_native', () => {
        expect(shouldRequireSiweHmacSecret({ AUTH_METHODS: ['oidc'] })).toBe(false);
        expect(shouldRequireSiweHmacSecret({ AUTH_METHODS: [] })).toBe(false);
    });
});

describe('shouldRequirePolicyListener', () => {
    it('returns true when multi-org is on and the opt-out is unset', () => {
        expect(
            shouldRequirePolicyListener({ MULTI_ORG_ENABLED: true, INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: false })
        ).toBe(true);
    });

    it('returns false when multi-org is off', () => {
        expect(
            shouldRequirePolicyListener({ MULTI_ORG_ENABLED: false, INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: false })
        ).toBe(false);
    });

    it('returns false when the opt-out is set', () => {
        expect(
            shouldRequirePolicyListener({ MULTI_ORG_ENABLED: true, INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: true })
        ).toBe(false);
    });
});

describe('shouldRequirePolicyAuthToken', () => {
    it('returns true whenever a policy port is set', () => {
        expect(shouldRequirePolicyAuthToken({ POLICY_PORT: 8010 })).toBe(true);
    });

    it('returns false when no policy port is set', () => {
        expect(shouldRequirePolicyAuthToken({})).toBe(false);
        expect(shouldRequirePolicyAuthToken({ POLICY_PORT: undefined })).toBe(false);
    });
});

// The committed .env.example is a complete, valid configuration. Parsing it as the baseline
// keeps these tests in sync with the documented env contract instead of hard-coding ~70 vars.
const EXAMPLE_ENV = parse(readFileSync(fileURLToPath(new URL('../.env.example', import.meta.url))));

// Well-known config vars added by the unified config endpoint. All are required.
const WELL_KNOWN_REQUIRED = [
    'CHAIN_NAME',
    'NATIVE_TOKEN_NAME',
    'NATIVE_TOKEN_SYMBOL',
    'NATIVE_TOKEN_DECIMALS',
    'BLOCK_EXPLORER_URL',
    'PRIVIDIUM_API_URL',
    'L1_CHAIN_ID',
    'L1_CHAIN_NAME'
] as const;

describe('loadEnv', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('parses the example configuration and coerces well-known fields to their types', () => {
        const env = loadEnv();

        expect(env.NATIVE_TOKEN_DECIMALS).toBe(18);
        expect(typeof env.L1_CHAIN_ID).toBe('number');
        expect(env.PRIVIDIUM_API_URL).toBe(EXAMPLE_ENV.PRIVIDIUM_API_URL);
        expect(env.BLOCK_EXPLORER_URL).toBe(EXAMPLE_ENV.BLOCK_EXPLORER_URL);
        expect(env.USER_PANEL_URL).toBe(EXAMPLE_ENV.USER_PANEL_URL);
        expect(env.CHAIN_NAME).toBe(EXAMPLE_ENV.CHAIN_NAME);
    });

    it.each(WELL_KNOWN_REQUIRED)('throws when required well-known var %s is missing', (key) => {
        delete process.env[key];
        expect(() => loadEnv()).toThrow();
    });

    it('requires USER_PANEL_URL unconditionally, independent of Swagger/WebAuthn config', () => {
        // USER_PANEL_URL is now always required (the well-known userPanelUrl). Removing the
        // SWAGGER_UI_ALLOWED_ROLES gate must not make it optional.
        delete process.env.SWAGGER_UI_ALLOWED_ROLES;
        delete process.env.USER_PANEL_URL;
        expect(() => loadEnv()).toThrow();
    });

    it('rejects a non-URL USER_PANEL_URL', () => {
        process.env.USER_PANEL_URL = 'not-a-url';
        expect(() => loadEnv()).toThrow();
    });

    it('treats NATIVE_TOKEN_L1_ADDRESS as optional', () => {
        delete process.env.NATIVE_TOKEN_L1_ADDRESS;
        expect(() => loadEnv()).not.toThrow();
        expect(loadEnv().NATIVE_TOKEN_L1_ADDRESS).toBeUndefined();
    });

    it('rejects an invalid NATIVE_TOKEN_L1_ADDRESS', () => {
        process.env.NATIVE_TOKEN_L1_ADDRESS = 'not-an-address';
        expect(() => loadEnv()).toThrow();
    });

    it('treats SWAGGER_DOCS_REDIRECT_URLS as optional, defaulting to an empty list', () => {
        delete process.env.SWAGGER_DOCS_REDIRECT_URLS;
        expect(loadEnv().SWAGGER_DOCS_REDIRECT_URLS).toEqual([]);
    });

    it('treats an empty SWAGGER_DOCS_REDIRECT_URLS as unset', () => {
        process.env.SWAGGER_DOCS_REDIRECT_URLS = '';
        expect(loadEnv().SWAGGER_DOCS_REDIRECT_URLS).toEqual([]);
    });

    it('parses a comma-separated SWAGGER_DOCS_REDIRECT_URLS', () => {
        process.env.SWAGGER_DOCS_REDIRECT_URLS =
            'https://api.a.example.com/docs/callback,https://api.b.example.com/docs/callback';
        expect(loadEnv().SWAGGER_DOCS_REDIRECT_URLS).toEqual([
            'https://api.a.example.com/docs/callback',
            'https://api.b.example.com/docs/callback'
        ]);
    });

    it('rejects a non-URL SWAGGER_DOCS_REDIRECT_URLS', () => {
        process.env.SWAGGER_DOCS_REDIRECT_URLS = 'not-a-url';
        expect(() => loadEnv()).toThrow();
    });
});

describe('policy listener validation (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('parses the example configuration, which runs single-org with no policy listener', () => {
        expect(EXAMPLE_ENV.MULTI_ORG_ENABLED).toBe('false');
        expect(EXAMPLE_ENV.POLICY_PORT).toBeUndefined();
        expect(EXAMPLE_ENV.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED).toBe('false');
        expect(() => loadEnv()).not.toThrow();
    });

    it('throws when MULTI_ORG_ENABLED is true with no POLICY_PORT', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        expect(() => loadEnv()).toThrow();
    });

    it('throws regardless of NODE_ENV, which the image bakes to production', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        for (const nodeEnv of ['development', 'test', 'production']) {
            process.env.NODE_ENV = nodeEnv;
            expect(() => loadEnv()).toThrow();
        }
    });

    it('accepts MULTI_ORG_ENABLED with no POLICY_PORT when the insecure opt-out is set', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED = 'true';
        expect(() => loadEnv()).not.toThrow();
    });

    it('accepts MULTI_ORG_ENABLED once the policy listener is configured', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.POLICY_PORT = '8010';
        process.env.POLICY_AUTH_TOKEN = 'shared-secret';
        expect(() => loadEnv()).not.toThrow();
    });

    it('still requires POLICY_AUTH_TOKEN when the insecure opt-out is set alongside a port', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED = 'true';
        process.env.POLICY_PORT = '8010';
        expect(() => loadEnv()).toThrow();
    });

    it('throws when POLICY_PORT is set without POLICY_AUTH_TOKEN', () => {
        process.env.POLICY_PORT = '8010';
        expect(() => loadEnv()).toThrow();
    });

    it('throws when POLICY_PORT is set with an empty POLICY_AUTH_TOKEN', () => {
        process.env.POLICY_PORT = '8010';
        process.env.POLICY_AUTH_TOKEN = '';
        expect(() => loadEnv()).toThrow();
    });
});

describe('findTargetChainTypeConflict', () => {
    const base = { POLICY_PORT: undefined, MULTI_ORG_ENABLED: false, DISCLOSURE_METHODS_ENABLED: false };

    it('never conflicts on zksync-os', () => {
        expect(
            findTargetChainTypeConflict({
                TARGET_CHAIN_TYPE: 'zksync-os',
                POLICY_PORT: 8010,
                MULTI_ORG_ENABLED: true,
                DISCLOSURE_METHODS_ENABLED: true
            })
        ).toBeUndefined();
    });

    it('accepts besu with zksync-os-only config off', () => {
        expect(findTargetChainTypeConflict({ TARGET_CHAIN_TYPE: 'besu', ...base })).toBeUndefined();
    });

    it.each([
        ['POLICY_PORT', { POLICY_PORT: 8010 }],
        ['MULTI_ORG_ENABLED', { MULTI_ORG_ENABLED: true }],
        ['DISCLOSURE_METHODS_ENABLED', { DISCLOSURE_METHODS_ENABLED: true }]
    ] as const)('rejects besu with %s set', (variable, override) => {
        expect(findTargetChainTypeConflict({ TARGET_CHAIN_TYPE: 'besu', ...base, ...override })?.variable).toBe(
            variable
        );
    });
});

describe('TARGET_CHAIN_TYPE validation (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('defaults to zksync-os', () => {
        delete process.env.TARGET_CHAIN_TYPE;
        expect(loadEnv().TARGET_CHAIN_TYPE).toBe('zksync-os');
    });

    it('rejects unknown chain types', () => {
        process.env.TARGET_CHAIN_TYPE = 'geth';
        expect(() => loadEnv()).toThrow();
    });

    it('accepts besu with the example configuration', () => {
        process.env.TARGET_CHAIN_TYPE = 'besu';
        expect(loadEnv().TARGET_CHAIN_TYPE).toBe('besu');
    });

    it.each([
        ['POLICY_PORT', '8010'],
        ['MULTI_ORG_ENABLED', 'true'],
        ['DISCLOSURE_METHODS_ENABLED', 'true']
    ])('throws on besu with %s set', (key, value) => {
        process.env.TARGET_CHAIN_TYPE = 'besu';
        process.env[key] = value;
        if (key === 'POLICY_PORT') process.env.POLICY_AUTH_TOKEN = 'token';
        // MULTI_ORG_ENABLED=true also trips the POLICY_PORT-required check; the opt-out
        // disarms it so only the chain-type conflict can make this throw.
        if (key === 'MULTI_ORG_ENABLED') process.env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED = 'true';
        expect(() => loadEnv()).toThrow();
    });
});

describe('USER_IDLE_TIMEOUT_SECONDS validation (via loadEnv)', () => {
    // Minimal complete env that passes loadEnv. Feature flags are forced off so the
    // parse depends only on the vars under test, not on ambient process.env values.
    const baseEnv: Record<string, string> = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/prividium_api',
        CORS_ORIGIN: 'http://localhost:3000',
        CORS_CACHE_DURATION_MS: '60000',
        SEQUENCER_RPC_URL: 'http://localhost:8545',
        CHAIN_NAME: 'Prividium Local',
        NATIVE_TOKEN_NAME: 'Ether',
        NATIVE_TOKEN_SYMBOL: 'ETH',
        NATIVE_TOKEN_DECIMALS: '18',
        BLOCK_EXPLORER_URL: 'http://localhost:3010',
        PRIVIDIUM_API_URL: 'http://localhost:8000',
        USER_PANEL_URL: 'http://localhost:3001',
        L1_CHAIN_ID: '31337',
        L1_CHAIN_NAME: 'Anvil Localhost',
        AUTH_METHODS: 'oidc',
        OIDC_JWKS_URI: 'http://localhost/jwks',
        OIDC_JWT_ISSUER: 'http://localhost/issuer',
        OIDC_JWT_AUD: 'test-aud',
        SIWE_CHAIN_ID: '1',
        SIWE_VALID_DOMAINS: 'localhost',
        WEBAUTHN_RP_NAME: 'test',
        WEBAUTHN_RP_ID: 'localhost',
        WEBAUTHN_ORIGIN: 'http://localhost:3000',
        WEBAUTHN_REQUIRE_USER_VERIFICATION: 'false',
        ADMIN_PANEL_REDIRECT_URLS: 'http://localhost:3000/callback',
        BLOCK_EXPLORER_REDIRECT_URLS: 'http://localhost:3001/callback',
        WALLETS_API_ENABLED: 'false',
        FAUCET_ENABLED: 'false',
        BUNDLER_ENABLED: 'false',
        THE_GRAPH_API_ENABLED: 'false',
        SENTRY_DSN: ''
    };

    function stubEnv(overrides: Record<string, string>) {
        for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
            vi.stubEnv(key, value);
        }
    }

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('rejects when USER_IDLE_TIMEOUT_SECONDS strictly exceeds USER_SESSION_DURATION_SECONDS', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600', USER_IDLE_TIMEOUT_SECONDS: '7200' });
        expect(() => loadEnv()).toThrow();
    });

    it('accepts when USER_IDLE_TIMEOUT_SECONDS is below the cap', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600', USER_IDLE_TIMEOUT_SECONDS: '600' });
        expect(() => loadEnv()).not.toThrow();
    });

    it('accepts when USER_IDLE_TIMEOUT_SECONDS equals the cap (degenerate fixed-expiry)', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600', USER_IDLE_TIMEOUT_SECONDS: '3600' });
        expect(() => loadEnv()).not.toThrow();
    });

    it('accepts when USER_IDLE_TIMEOUT_SECONDS is unset (feature OFF)', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600' });
        expect(() => loadEnv()).not.toThrow();
    });
});
