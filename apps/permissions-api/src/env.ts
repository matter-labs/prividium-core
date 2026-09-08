import path from 'node:path';
import { createEnv } from '@t3-oss/env-core';
import { config } from 'dotenv';
import { z } from 'zod/v4';
import { addressSchema } from './utils/schemas/address';
import { hexSchema } from './utils/schemas/hex-schema';
import { TARGET_CHAIN_TYPES, type TargetChainType } from './utils/target-chain';

let ROOT_PATH: string;

try {
    // biome-ignore lint/security/noGlobalEval: Required for import.meta.dirname compatibility with drizzle-kit
    // biome-ignore lint/complexity/noCommaOperator: Indirect eval pattern
    const DIRNAME = (0, eval)('import.meta.dirname') as string;
    ROOT_PATH = path.join(DIRNAME, '..');
} catch {
    // drizzle-kit: fall back to current directory
    ROOT_PATH = '.';
}

config({ path: [path.join(ROOT_PATH, '.env'), path.join(ROOT_PATH, '.env.local')] });

const commaSeparatedString = z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.string().trim().array().min(1));

const commaSeparatedUrls = z
    .url()
    .transform((value) => value.split(','))
    .pipe(z.string().trim().array().min(1));

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');
const portSchema = z.coerce.number().int().min(1).max(65535);
const MIN_HMAC_SECRET_BYTES = 32;
const SIWE_HMAC_SECRET_ERROR = 'Each SIWE_HMAC_SECRET entry must be hex encoded and at least 32 bytes (64 hex chars)';

const siweHmacSecretEntrySchema = z.string().refine(isValidSiweHmacSecret, {
    message: SIWE_HMAC_SECRET_ERROR
});

const siweHmacSecretSchema = commaSeparatedString
    .pipe(siweHmacSecretEntrySchema.array())
    .transform((secrets) => secrets.join(','));

export const loadEnv = () =>
    createEnv({
        server: {
            NODE_ENV: z.enum(['development', 'production', 'test']),
            VERSION: z.string().optional(),
            DATABASE_URL: z.string().optional(),
            DATABASE_HOST: z.string().optional(),
            DATABASE_PORT: portSchema.optional(),
            DATABASE_USER: z.string().optional(),
            DATABASE_PASSWORD: z.string().optional(),
            DATABASE_ENABLE_SSL: booleanFromString.default(false),
            DATABASE_SSL_REJECT_UNAUTHORIZED: booleanFromString.default(false),
            DATABASE_NAME: z.string().optional(),
            // Where this service's migration journal sits, resolved against the working
            // directory. Only set when something boots this service from elsewhere.
            MIGRATIONS_DIR: z.string().default('./drizzle'),
            LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
            PORT: portSchema.default(3000),
            METRICS_PORT: portSchema.default(9090),
            SENTRY_DSN: z.string().optional(),
            SENTRY_ENVIRONMENT: z.string().optional(),
            CORS_ORIGIN: commaSeparatedString,
            SEQUENCER_RPC_URL: z.string(),
            TARGET_CHAIN_TYPE: z.enum(TARGET_CHAIN_TYPES).default('zksync-os'),
            AUTH_METHODS: commaSeparatedString.pipe(z.enum(['oidc', 'crypto_native']).array()),
            USER_SESSION_DURATION_SECONDS: z.coerce.number().default(3600), // 1 hour
            USER_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(), // unset = idle timeout feature OFF
            TENANT_SESSION_DURATION_SECONDS: z.coerce.number().default(3600), // 1 hour
            SERVICE_SESSION_DURATION_SECONDS: z.coerce.number().default(86400), // 24 hours
            HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(1_000), // 1 second
            DB_QUERY_TIMEOUT_MS: z.coerce.number().default(100_000), // 100 seconds
            DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(100_000), // 100 seconds
            DB_POOL_MAX_CONNECTIONS: z.coerce.number().int().min(1).default(10),
            DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000), // 5 seconds
            CORS_CACHE_DURATION_MS: z.coerce.number(),

            // SIWE
            SIWE_CHAIN_ID: z.coerce.number(),
            SIWE_EXPIRATION_MS: z.coerce.number().default(5 * 60 * 1000),
            SIWE_VALID_DOMAINS: commaSeparatedString,
            SIWE_HMAC_SECRET: siweHmacSecretSchema.optional(),
            SIWE_CHALLENGE_RATE_LIMIT_COUNT: z.coerce.number().default(10),
            SIWE_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(5 * 60),
            SIWE_CONSUMED_NONCE_TTL_SECONDS: z.coerce.number().default(600),
            SIWE_CLEANUP_INTERVAL_SECONDS: z.coerce.number().default(60),
            SIWE_CHALLENGE_RATE_LIMIT_BYPASS_IPS: commaSeparatedString.optional(),

            // Deployment row lifecycle. Pending rows past the TTL are reconciled
            // against the chain and errored only when the tx is gone. Errored rows
            // are deleted after the retention window. Cleanup interval drives
            // both sweeps. Defaults: 1h TTL, 7d retention, 5min cadence.
            DEPLOYMENT_PENDING_TTL_SECONDS: z.coerce.number().default(60 * 60),
            DEPLOYMENT_ERRORED_RETENTION_SECONDS: z.coerce.number().default(7 * 24 * 60 * 60),
            DEPLOYMENT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().default(5 * 60),

            // OIDC
            OIDC_ADMIN_SUBS: commaSeparatedString.optional().default([]),
            OIDC_JWKS_URI: z.string().optional(),
            OIDC_JWT_AUD: z.string().optional(),
            OIDC_JWT_ISSUER: z.string().optional(),

            // Crypto Native
            CRYPTO_NATIVE_ADMIN_WALLETS: commaSeparatedString.optional().default([]),

            // Embedded in SIWE challenge statements, which reject line breaks (EIP-4361).
            BRAND_NAME: z
                .string()
                .max(200)
                .regex(/^[^\r\n]+$/, 'BRAND_NAME must not contain line breaks')
                .optional()
                .default('Prividium™'),

            // WebAuthn
            WEBAUTHN_RP_NAME: z.string(),
            WEBAUTHN_RP_ID: z.string(),
            WEBAUTHN_ORIGIN: commaSeparatedString,
            WEBAUTHN_REQUIRE_USER_VERIFICATION: booleanFromString,
            WEBAUTHN_AUTHENTICATOR_ATTACHMENT: z.enum(['platform', 'cross-platform']).optional(),

            // Canonical user-panel URL used for the /docs OAuth redirect. Decoupled
            // from WEBAUTHN_ORIGIN so the latter can list multiple origins (user-panel
            // and adminv2) that are both allowed to produce WebAuthn assertions.
            USER_PANEL_URL: z.url(),

            // Oauth Redirect urls
            ADMIN_PANEL_REDIRECT_URLS: commaSeparatedUrls,
            BLOCK_EXPLORER_REDIRECT_URLS: commaSeparatedUrls,
            // Extra allowed /docs OAuth callback URLs for vanity hostnames;
            // the request-derived `<origin>/docs/callback` is always allowed.
            SWAGGER_DOCS_REDIRECT_URLS: commaSeparatedUrls.optional().default([]),

            // Swagger UI access control
            // Comma-separated role ids permitted to view /docs (the built-in zone admin role has the id "admin").
            // Set to "none" to disable the endpoint entirely.
            SWAGGER_UI_ALLOWED_ROLES: z
                .string()
                .optional()
                .default('admin')
                .transform((s) => {
                    if (s.trim().toLowerCase() === 'none') return [] as string[];
                    return s
                        .split(',')
                        .map((r) => r.trim())
                        .filter(Boolean);
                }),

            // Bundler (ERC-4337)
            BUNDLER_ENABLED: booleanFromString.default(false),
            BUNDLER_RPC_URL: z.string().optional(),

            // The Graph API
            THE_GRAPH_API_ENABLED: booleanFromString.default(false),
            THE_GRAPH_API_URL: z.string().optional(),

            // Faucet
            FAUCET_ENABLED: booleanFromString.default(false),
            FAUCET_OPERATOR_PRIVATE_KEY: hexSchema.optional(),
            FAUCET_CLAIM_AMOUNT_WEI: z.coerce.bigint().positive().optional(),
            FAUCET_COOLDOWN_SECONDS: z.coerce.number().int().positive().optional(),
            FAUCET_STALE_PENDING_SECONDS: z.coerce.number().int().positive().optional(),
            // Rolling 24h cap on successful claim sum. Set to 0 to disable the cap.
            FAUCET_MAX_DAILY_SPEND_WEI: z.coerce.bigint().nonnegative().optional(),
            FAUCET_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

            // Dynamic Dispatcher Verification (optional - leave empty to disable)
            // SSO BeaconProxy bytecode hashes (comma-separated)
            DISPATCHER_SSO_BYTECODE_HASHES: z.string().optional(),
            // SSO implementation addresses (comma-separated)
            DISPATCHER_SSO_IMPLEMENTATIONS: z.string().optional(),

            // feature flags
            WALLETS_API_ENABLED: booleanFromString,
            TENANTS_ENABLED: booleanFromString.default(false),
            DISCLOSURE_METHODS_ENABLED: booleanFromString.default(false),
            MULTI_ORG_ENABLED: booleanFromString.default(false),
            ORG_ROUTING_BY_DOMAIN: booleanFromString.default(false),
            // Off (the default) writes nothing and does not register the endpoints.
            MAX_ORGANIZATIONS: z.coerce.number().int().min(1).default(100),
            MAX_WALLETS_PER_USER: z.coerce.number().int().min(1).default(100),
            AUDIT_LOGS_PAGINATION_MAX_ITEMS: z.coerce.number().int().min(1).default(10_000),
            INSECURE_M2M_ALLOW_ANY_IP_ENABLED: booleanFromString.default(false),
            // INSECURE: allows MULTI_ORG_ENABLED with no POLICY_PORT. Only for the dev and CI
            // stacks, whose sequencer has no policy protocol to call the listener with.
            INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: booleanFromString.default(false),

            // Proxy settings (for X-Forwarded-For IP resolution)
            TRUST_X_FORWARDED_FOR: commaSeparatedString.optional(),

            // API Key settings
            API_KEY_MAX_EXPIRATION_SECONDS: z.coerce.number().default(365 * 24 * 60 * 60), // 1 year

            // Rate limiting
            RATE_LIMIT_ENABLED: booleanFromString.default(true),
            RATE_LIMIT_AUTH_MAX: z.coerce.number().default(100),
            RATE_LIMIT_PUBLIC_MAX: z.coerce.number().default(300),
            RATE_LIMIT_USER_MAX: z.coerce.number().default(300),
            RATE_LIMIT_RPC_MAX: z.coerce.number().default(1000),
            RATE_LIMIT_M2M_MAX: z.coerce.number().default(1000),
            RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),

            EXTRA_PUBLIC_CODE_ADDRESSES: commaSeparatedString.pipe(hexSchema.array()).default([]),

            // Security overrides.
            // Comma-separated allowlist of EVM addresses that bypass the well-known
            // dev wallet block. Addresses on the well-known list (Anvil/Hardhat/Foundry
            // defaults, era-test-node rich wallets, Ganache deterministic accounts)
            // are normally refused on association — their private keys are public.
            // Populate only in local-dev / CI / test environments with the specific
            // anvil accounts your fixtures use. Production deployments MUST leave
            // this empty (defaults to []).
            KNOWN_DEV_WALLETS_ALLOWLIST: commaSeparatedString.pipe(addressSchema.array()).default([]),

            // TxValidator policy service (see POST /admit, POST /judge).
            // Comma-separated list of opaque protocol versions accepted from
            // the sequencer. A request whose `protocolVersion` is in this set
            // is processed normally; anything else returns
            // `protocol.version_mismatch`. Carrying multiple versions lets you
            // roll prividium and the server independently — bump prividium to
            // accept v_old + v_new, then have the server flip from v_old to
            // v_new, then drop v_old. The first entry is the preferred
            // version, advertised on the response when the request's version
            // doesn't match anything in the set.
            POLICY_PROTOCOL_VERSIONS: commaSeparatedString.default(['1']),
            // Bearer-token listener for /admit and /judge. When POLICY_PORT is
            // unset, the policy listener is not started (the routes are
            // unreachable) — convenient for tests and non-Prividium deploys.
            // POLICY_AUTH_TOKEN is the static shared secret sent by the
            // sequencer as `Authorization: Bearer <token>`.
            POLICY_PORT: z.coerce.number().int().positive().optional(),
            POLICY_AUTH_TOKEN: z.string().optional(),
            // In-memory read-through cache for /admit and /judge decisions. The
            // same tx is evaluated at mempool inclusion and again at block
            // building, so the repeat is a guaranteed hit. Invalidation is
            // TTL-only: a permission change is reflected after the entry TTL.
            POLICY_DECISION_CACHE_ENABLED: booleanFromString.default(false),
            POLICY_DECISION_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
            POLICY_DECISION_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(50_000),

            // Prividium info
            CHAIN_NAME: z.string(),
            NATIVE_TOKEN_NAME: z.string(),
            NATIVE_TOKEN_SYMBOL: z.string(),
            NATIVE_TOKEN_DECIMALS: z.coerce.number(),
            // L1 address of the native token (custom base-token deployments).
            // Unset for ETH-based chains; emitted as `null` on the well-known.
            NATIVE_TOKEN_L1_ADDRESS: addressSchema.optional(),
            BLOCK_EXPLORER_URL: z.url(),
            PRIVIDIUM_API_URL: z.url(),
            L1_CHAIN_ID: z.coerce.number().int().positive(),
            L1_CHAIN_NAME: z.string(),
            // Narrows which wallets the user panel features in its connect picker (EIP-6963 rdns
            // values, e.g. 'io.metamask,io.rabby'). Omit to feature the panel's full wallet registry.
            FEATURED_WALLET_IDS: commaSeparatedString.optional()
        },
        runtimeEnv: process.env,
        emptyStringAsUndefined: true,
        createFinalSchema: (shape) =>
            z.object(shape).transform((env, ctx) => {
                if (env.SENTRY_DSN && !env.SENTRY_ENVIRONMENT) {
                    ctx.addIssue({
                        code: 'custom',
                        message: 'SENTRY_ENVIRONMENT is required when SENTRY_DSN is provided',
                        path: ['SENTRY_ENVIRONMENT']
                    });
                    return z.NEVER;
                }
                if (env.AUTH_METHODS.includes('oidc')) {
                    if (oidcAuthRequiredVars.some((v) => env[v] === undefined)) {
                        ctx.addIssue({
                            code: 'custom',
                            message: `${oidcAuthRequiredVars.join(', ')} are required when AUTH_METHODS includes oidc`,
                            path: oidcAuthRequiredVars
                        });
                        return z.NEVER;
                    }
                }
                if (env.BUNDLER_ENABLED && !env.BUNDLER_RPC_URL) {
                    ctx.addIssue({
                        code: 'custom',
                        message: 'BUNDLER_RPC_URL is required when BUNDLER_ENABLED is true',
                        path: ['BUNDLER_RPC_URL']
                    });
                    return z.NEVER;
                }

                if (env.THE_GRAPH_API_ENABLED && !env.THE_GRAPH_API_URL) {
                    ctx.addIssue({
                        code: 'custom',
                        message: 'THE_GRAPH_API_URL is required when THE_GRAPH_API_ENABLED is true',
                        path: ['THE_GRAPH_API_URL']
                    });
                    return z.NEVER;
                }

                if (env.FAUCET_ENABLED) {
                    const missingFaucetVars: (keyof typeof env)[] = [];
                    if (env.FAUCET_OPERATOR_PRIVATE_KEY === undefined)
                        missingFaucetVars.push('FAUCET_OPERATOR_PRIVATE_KEY');
                    if (env.FAUCET_CLAIM_AMOUNT_WEI === undefined) missingFaucetVars.push('FAUCET_CLAIM_AMOUNT_WEI');
                    if (env.FAUCET_COOLDOWN_SECONDS === undefined) missingFaucetVars.push('FAUCET_COOLDOWN_SECONDS');
                    if (env.FAUCET_STALE_PENDING_SECONDS === undefined)
                        missingFaucetVars.push('FAUCET_STALE_PENDING_SECONDS');
                    if (env.FAUCET_MAX_DAILY_SPEND_WEI === undefined)
                        missingFaucetVars.push('FAUCET_MAX_DAILY_SPEND_WEI');
                    if (missingFaucetVars.length > 0) {
                        ctx.addIssue({
                            code: 'custom',
                            message: `${missingFaucetVars.join(', ')} ${missingFaucetVars.length === 1 ? 'is' : 'are'} required when FAUCET_ENABLED is true`,
                            path: missingFaucetVars as string[]
                        });
                        return z.NEVER;
                    }
                }

                if (isIdleTimeoutExceedsSessionCap(env)) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'USER_IDLE_TIMEOUT_SECONDS must not exceed USER_SESSION_DURATION_SECONDS (the absolute session cap)',
                        path: ['USER_IDLE_TIMEOUT_SECONDS']
                    });
                    return z.NEVER;
                }

                if (shouldRequireSiweHmacSecret(env) && !env.SIWE_HMAC_SECRET) {
                    ctx.addIssue({
                        code: 'custom',
                        message: 'SIWE_HMAC_SECRET is required when AUTH_METHODS includes crypto_native',
                        path: ['SIWE_HMAC_SECRET']
                    });
                    return z.NEVER;
                }

                const chainTypeConflict = findTargetChainTypeConflict(env);
                if (chainTypeConflict) {
                    ctx.addIssue({
                        code: 'custom',
                        message: chainTypeConflict.message,
                        path: [chainTypeConflict.variable]
                    });
                    return z.NEVER;
                }

                if (shouldRequirePolicyListener(env) && env.POLICY_PORT === undefined) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'POLICY_PORT is required when MULTI_ORG_ENABLED is true: without the /judge listener only the top-level call of a transaction is authorized, so an organization reaches another organization through any contract that forwards calls. Dev and CI stacks with no protocol-v31 sequencer set INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED=true instead',
                        path: ['POLICY_PORT']
                    });
                    return z.NEVER;
                }

                if (shouldRequirePolicyAuthToken(env) && !env.POLICY_AUTH_TOKEN) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'POLICY_AUTH_TOKEN is required when POLICY_PORT is set: an unauthenticated /admit answers whether an arbitrary transaction would be allowed',
                        path: ['POLICY_AUTH_TOKEN']
                    });
                    return z.NEVER;
                }

                // Construct DATABASE_URL from individual components if not provided
                let databaseUrl: string;
                try {
                    databaseUrl = constructDatabaseUrl(env);
                } catch (error) {
                    ctx.addIssue({
                        code: 'custom',
                        message: error instanceof Error ? error.message : 'Failed to construct DATABASE_URL',
                        path: ['DATABASE_URL']
                    });
                    return z.NEVER;
                }

                return {
                    ...env,
                    DATABASE_URL: databaseUrl
                };
            })
    });

const oidcAuthRequiredVars = ['OIDC_JWKS_URI', 'OIDC_JWT_ISSUER', 'OIDC_JWT_AUD'] satisfies (keyof Env)[];
export function envHasOidcAuthMethod(env: Env): env is Env & { [K in (typeof oidcAuthRequiredVars)[number]]: string } {
    return env.AUTH_METHODS.includes('oidc');
}

export function envHasCryptoNativeAuthMethod(env: Env): env is Env {
    return env.AUTH_METHODS.includes('crypto_native');
}

export function shouldRequireSiweHmacSecret(env: { AUTH_METHODS: string[] }): boolean {
    return env.AUTH_METHODS.includes('crypto_native');
}

/**
 * Multi-org isolation is only enforced on inner call frames by /judge.
 * The opt-out is deliberately not scoped to NODE_ENV: the image bakes
 * NODE_ENV=production, so it cannot tell a deployment from the dev stack.
 */
export function shouldRequirePolicyListener(env: {
    MULTI_ORG_ENABLED: boolean;
    INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: boolean;
}): boolean {
    return env.MULTI_ORG_ENABLED && !env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED;
}

export function shouldRequirePolicyAuthToken(env: { POLICY_PORT?: number }): boolean {
    return env.POLICY_PORT !== undefined;
}

export function findTargetChainTypeConflict(env: {
    TARGET_CHAIN_TYPE: TargetChainType;
    POLICY_PORT?: number;
    MULTI_ORG_ENABLED: boolean;
    DISCLOSURE_METHODS_ENABLED: boolean;
}): { variable: string; message: string } | undefined {
    if (env.TARGET_CHAIN_TYPE === 'zksync-os') {
        return undefined;
    }
    const chain = env.TARGET_CHAIN_TYPE;
    if (env.POLICY_PORT !== undefined) {
        return {
            variable: 'POLICY_PORT',
            message: `POLICY_PORT must be unset when TARGET_CHAIN_TYPE is '${chain}': the /admit + /judge TxValidator protocol is only spoken by zksync-os sequencers`
        };
    }
    if (env.MULTI_ORG_ENABLED) {
        return {
            variable: 'MULTI_ORG_ENABLED',
            message: `MULTI_ORG_ENABLED is not supported when TARGET_CHAIN_TYPE is '${chain}': organization isolation on inner call frames is enforced by the chain's /judge pass, which only zksync-os provides`
        };
    }
    if (env.DISCLOSURE_METHODS_ENABLED) {
        return {
            variable: 'DISCLOSURE_METHODS_ENABLED',
            message: `DISCLOSURE_METHODS_ENABLED is not supported when TARGET_CHAIN_TYPE is '${chain}': disclosure methods depend on zks_getProof, zks_L1BatchNumber and custom JS tracers, which '${chain}' does not serve`
        };
    }
    return undefined;
}

/** True when the idle timeout is set and strictly exceeds the session cap (equal is allowed). */
function isIdleTimeoutExceedsSessionCap(env: {
    USER_IDLE_TIMEOUT_SECONDS?: number;
    USER_SESSION_DURATION_SECONDS: number;
}): boolean {
    return (
        env.USER_IDLE_TIMEOUT_SECONDS !== undefined && env.USER_IDLE_TIMEOUT_SECONDS > env.USER_SESSION_DURATION_SECONDS
    );
}

function isValidSiweHmacSecret(secret: string): boolean {
    if (!/^[0-9a-fA-F]+$/.test(secret) || secret.length % 2 !== 0) {
        return false;
    }

    return Buffer.from(secret, 'hex').length >= MIN_HMAC_SECRET_BYTES;
}

function constructDatabaseUrl(env: {
    DATABASE_URL?: string;
    DATABASE_HOST?: string;
    DATABASE_PORT?: number;
    DATABASE_USER?: string;
    DATABASE_PASSWORD?: string;
    DATABASE_NAME?: string;
}): string {
    if (env.DATABASE_URL) {
        return env.DATABASE_URL;
    }

    const host = env.DATABASE_HOST;
    const port = env.DATABASE_PORT;
    const username = env.DATABASE_USER;
    const password = env.DATABASE_PASSWORD;
    const database = env.DATABASE_NAME;

    if (!host || !username || !password || !database || !port) {
        throw new Error(
            'Missing required database components. Either provide DATABASE_URL or all of: DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME, DATABASE_PORT'
        );
    }

    return `postgres://${username}:${password}@${host}:${port}/${database}`;
}

export type Env = ReturnType<typeof loadEnv>;
