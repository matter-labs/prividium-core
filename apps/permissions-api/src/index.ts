import type { RpcObserverFactory } from '@repo/api-kit';
import * as Sentry from '@sentry/node';
import closeWithGrace from 'close-with-grace';
import type { Pool } from 'pg';
import { type AppConfig, buildApp, type FeatureRuntime } from './build-app';
import { buildPolicyApp, type PolicyAppConfig } from './build-policy-app';
import { RepositoriesCoreFacts } from './core-facts/repositories-core-facts';
import { createDb, runWithJobContext } from './db';
import { runMigrations } from './db/migrate';
import { envHasCryptoNativeAuthMethod, loadEnv } from './env';
import { syncSystemContracts } from './services/system-contracts/sync';
import { buildServerDeps } from './utils/build-server-deps';
import { createLogger } from './utils/logger';
import {
    metricsServer,
    multiOrgEnabledGauge,
    orgCountGauge,
    orgQuotaLimitGauge,
    policyListenerEnabledGauge
} from './utils/metrics';

const env = loadEnv();

const logger = createLogger();

if (env.SENTRY_DSN) {
    if (!env.SENTRY_ENVIRONMENT) {
        throw new Error('SENTRY_ENVIRONMENT is required when SENTRY_DSN is provided');
    }
    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT,
        release: env.VERSION,
        initialScope: {
            tags: {
                service: 'permissions-api'
            }
        }
    });

    // Capture uncaught exceptions
    process.on('uncaughtException', (error) => {
        logger.error(error, 'Uncaught exception');
        Sentry.captureException(error, {
            tags: { service: 'permissions-api' }
        });
        process.exit(1);
    });

    // Capture unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        logger.error({ reason, promise }, 'Unhandled promise rejection');
        Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
            tags: { service: 'permissions-api' }
        });
        process.exit(1);
    });
}

const db = createDb(
    env.DATABASE_URL,
    logger,
    env.DATABASE_ENABLE_SSL,
    env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    env.DB_QUERY_TIMEOUT_MS,
    env.DB_STATEMENT_TIMEOUT_MS,
    env.DB_POOL_MAX_CONNECTIONS,
    env.DB_POOL_CONNECTION_TIMEOUT_MS
);

const INSECURE_HMAC_SECRET = 'aaaaaaaa00000000aaaaaaaa00000000aaaaaaaa00000000aaaaaaaa00000000';

/** Passed by a composition root, so the core still names no feature and imports none. */
export type ServiceFeatures = {
    registerFeatures?: AppConfig['registerFeatures'];
    featureNames?: AppConfig['featureNames'];
    authorizationOverlays?: PolicyAppConfig['authorizationOverlays'];
    onAdmitDenied?: PolicyAppConfig['onAdmitDenied'];
    /** Built once at boot, because the observer writes after the response, outside any request scope. */
    rpcObserverFor?: (runtime: FeatureRuntime) => RpcObserverFactory;
    /** After this service's: a feature's tables may reference the core's. */
    runFeatureMigrations?: (pool: Pool) => Promise<void>;
};

const MIGRATION_ADVISORY_LOCK_ID = 0x91620;

/**
 * Both migrators under one lock. Drizzle's takes none, so replicas of this image
 * booting together would each run the same DDL and every loser would exit; a session
 * lock makes them wait and find the work already done.
 */
async function withMigrationLock(pool: Pool, run: () => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
        await run();
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
        client.release();
    }
}

export async function start(features: ServiceFeatures = {}) {
    if (envHasCryptoNativeAuthMethod(env) && env.SIWE_HMAC_SECRET === INSECURE_HMAC_SECRET) {
        logger.warn(
            'SIWE_HMAC_SECRET is set to the insecure all-zeros placeholder. Replace it with a strong secret before deploying to production.'
        );
    }

    const deps = buildServerDeps(env);

    if (env.NODE_ENV === 'production') {
        await withMigrationLock(db.$client, async () => {
            await runMigrations(db, logger, env.MIGRATIONS_DIR);
            await features.runFeatureMigrations?.(db.$client);
        });
    }

    // Run startup mutations on a dedicated connection stamped with job_id='system:startup'
    // so every db_mutation_audit_logs row carries job context instead of landing with
    // both request_id and job_id null.
    await runWithJobContext(db, 'system:startup', async (scopedDb) => {
        // Seed the admin role once at startup so per-request auth flows can assume it exists.
        await scopedDb.repositories().roles.createOrUpdateAdminRole();

        // OIDC identity is keyed by (issuer, sub); ensure pre-existing OIDC users carry an issuer so login still matches them.
        if (env.OIDC_JWT_ISSUER) {
            await scopedDb.repositories().users.backfillMissingOidcIssuer(env.OIDC_JWT_ISSUER);
        }

        // Strict-sync system contracts before serving traffic.
        // Any sync error will propagate to the top-level catch which calls process.exit(1).
        await syncSystemContracts(scopedDb, logger);

        orgQuotaLimitGauge.set(env.MAX_ORGANIZATIONS);
        orgCountGauge.set(await scopedDb.repositories().organizations.countNonDeleted());
    });

    multiOrgEnabledGauge.set(env.MULTI_ORG_ENABLED ? 1 : 0);
    policyListenerEnabledGauge.set(env.POLICY_PORT !== undefined ? 1 : 0);

    const runtime: FeatureRuntime = {
        pool: db.$client,
        coreFacts: new RepositoriesCoreFacts({ repos: db.repositories() }),
        metrics: metricsServer,
        logger
    };

    const app = await buildApp(db, {
        ...deps,
        ...(features.registerFeatures === undefined ? {} : { registerFeatures: features.registerFeatures }),
        ...(features.rpcObserverFor === undefined ? {} : { rpcObserverFor: features.rpcObserverFor(runtime) }),
        featureNames: features.featureNames ?? [],
        logger: logger.child({}, { level: env.LOG_LEVEL }),
        targetRpcUrl: env.SEQUENCER_RPC_URL,
        targetChainType: env.TARGET_CHAIN_TYPE,
        corsOrigins: env.CORS_ORIGIN,
        oidcOpts: deps.oidcOpts,
        adminOidcSubs: env.OIDC_ADMIN_SUBS,
        adminWallets: deps.adminWallets,
        authMethods: env.AUTH_METHODS,
        userSessionDurationSeconds: env.USER_SESSION_DURATION_SECONDS,
        userIdleTimeoutSeconds: env.USER_IDLE_TIMEOUT_SECONDS,
        tenantSessionDurationSeconds: env.TENANT_SESSION_DURATION_SECONDS,
        serviceSessionDurationSeconds: env.SERVICE_SESSION_DURATION_SECONDS,
        healthCheckIntervalMs: env.HEALTH_CHECK_INTERVAL_MS,
        oauthRedirectUrls: {
            adminPanel: env.ADMIN_PANEL_REDIRECT_URLS,
            blockExplorer: env.BLOCK_EXPLORER_REDIRECT_URLS,
            swaggerDocs: env.SWAGGER_DOCS_REDIRECT_URLS
        },
        // Prefer the explicit USER_PANEL_URL; fall back to WEBAUTHN_ORIGIN when it has
        // exactly one entry (preserves backward compatibility with single-origin setups).
        userPanelUrl: env.USER_PANEL_URL ?? (env.WEBAUTHN_ORIGIN.length === 1 ? env.WEBAUTHN_ORIGIN[0] : undefined),
        swaggerUiAllowedRoles: env.SWAGGER_UI_ALLOWED_ROLES,
        corsCacheDurationMs: env.CORS_CACHE_DURATION_MS,
        // Bundler config
        bundlerEnabled: env.BUNDLER_ENABLED,
        bundlerRpcUrl: env.BUNDLER_RPC_URL,
        theGraphApiEnabled: env.THE_GRAPH_API_ENABLED,
        theGraphApiUrl: env.THE_GRAPH_API_URL,
        // Faucet config. When FAUCET_ENABLED is true the conditional env validation in env.ts
        // guarantees all the required fields are present, so we can safely assert them here.
        faucet: env.FAUCET_ENABLED
            ? {
                  operatorPrivateKey: env.FAUCET_OPERATOR_PRIVATE_KEY!,
                  claimAmountWei: env.FAUCET_CLAIM_AMOUNT_WEI!,
                  cooldownSeconds: env.FAUCET_COOLDOWN_SECONDS!,
                  stalePendingSeconds: env.FAUCET_STALE_PENDING_SECONDS!,
                  maxDailySpendWei: env.FAUCET_MAX_DAILY_SPEND_WEI!,
                  txTimeoutMs: env.FAUCET_TX_TIMEOUT_MS
              }
            : undefined,
        dispatcherConfig: {
            ssoBytecodeHashes: env.DISPATCHER_SSO_BYTECODE_HASHES?.split(','),
            ssoImplementations: env.DISPATCHER_SSO_IMPLEMENTATIONS?.split(',')
        },
        walletRpcEnabled: env.WALLETS_API_ENABLED,
        tenantsEnabled: env.TENANTS_ENABLED,
        multiOrgEnabled: env.MULTI_ORG_ENABLED,
        orgRoutingByDomain: env.ORG_ROUTING_BY_DOMAIN,
        maxOrganizations: env.MAX_ORGANIZATIONS,
        maxWalletsPerUser: env.MAX_WALLETS_PER_USER,
        auditLogsPaginationMaxItems: env.AUDIT_LOGS_PAGINATION_MAX_ITEMS,
        insecureM2mAllowAnyIp: env.INSECURE_M2M_ALLOW_ANY_IP_ENABLED,
        webauthn: {
            rpName: env.WEBAUTHN_RP_NAME,
            rpId: env.WEBAUTHN_RP_ID,
            origins: env.WEBAUTHN_ORIGIN,
            requireUserVerification: env.WEBAUTHN_REQUIRE_USER_VERIFICATION,
            authenticatorAttachment: env.WEBAUTHN_AUTHENTICATOR_ATTACHMENT
        },
        trustXForwardedFor: env.TRUST_X_FORWARDED_FOR,
        apiKeyMaxExpirationSeconds: env.API_KEY_MAX_EXPIRATION_SECONDS,
        publicCodeAddresses: env.EXTRA_PUBLIC_CODE_ADDRESSES,
        knownDevWalletsAllowlist: env.KNOWN_DEV_WALLETS_ALLOWLIST,
        disclosureMethodsEnabled: env.DISCLOSURE_METHODS_ENABLED,
        brandName: env.BRAND_NAME,
        version: env.VERSION ?? 'local',
        policyEnabled: env.POLICY_PORT !== undefined,
        rateLimit: {
            enabled: env.RATE_LIMIT_ENABLED,
            auth: { max: env.RATE_LIMIT_AUTH_MAX },
            public: { max: env.RATE_LIMIT_PUBLIC_MAX },
            user: { max: env.RATE_LIMIT_USER_MAX },
            rpc: { max: env.RATE_LIMIT_RPC_MAX },
            m2m: { max: env.RATE_LIMIT_M2M_MAX },
            windowMs: env.RATE_LIMIT_WINDOW_MS
        },
        deploymentCleanup: {
            pendingTtlSeconds: env.DEPLOYMENT_PENDING_TTL_SECONDS,
            erroredRetentionSeconds: env.DEPLOYMENT_ERRORED_RETENTION_SECONDS,
            intervalSeconds: env.DEPLOYMENT_CLEANUP_INTERVAL_SECONDS
        }
    });

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`Server listening on port ${env.PORT}`);

    if (features.authorizationOverlays !== undefined && env.POLICY_PORT === undefined) {
        logger.warn(
            'A feature registered an authorization overlay but POLICY_PORT is unset, so neither /admit nor /judge is served and no transaction is ever put to it. The feature is advertised on /info and its rules can be authored, but nothing enforces them.'
        );
    }

    if (env.MULTI_ORG_ENABLED && env.POLICY_PORT === undefined) {
        logger.warn(
            'MULTI_ORG_ENABLED is true but POLICY_PORT is unset, so /judge is not served. Only the top-level call of a transaction is authorized: an organization reaches another organization through any contract that forwards calls.'
        );
    }

    // Bearer-token listener for /admit and /judge. Skipped when POLICY_PORT is unset.
    const policyApp =
        env.POLICY_PORT !== undefined
            ? buildPolicyApp(db, {
                  logger: logger.child({ component: 'policy-api' }, { level: env.LOG_LEVEL }),
                  protocolVersions: env.POLICY_PROTOCOL_VERSIONS,
                  authToken: env.POLICY_AUTH_TOKEN,
                  multiOrgEnabled: env.MULTI_ORG_ENABLED,
                  targetRpcUrl: env.SEQUENCER_RPC_URL,
                  decisionCache: env.POLICY_DECISION_CACHE_ENABLED
                      ? {
                            ttlMs: env.POLICY_DECISION_CACHE_TTL_MS,
                            maxEntries: env.POLICY_DECISION_CACHE_MAX_ENTRIES
                        }
                      : undefined,
                  ...(features.authorizationOverlays === undefined
                      ? {}
                      : { authorizationOverlays: features.authorizationOverlays }),
                  ...(features.onAdmitDenied === undefined ? {} : { onAdmitDenied: features.onAdmitDenied })
              })
            : undefined;
    if (policyApp) {
        await policyApp.listen({ port: env.POLICY_PORT, host: '0.0.0.0' });
        logger.info(`Policy listener on port ${env.POLICY_PORT}`);
    }

    await metricsServer.listen(env.METRICS_PORT);
    logger.info(`Metrics server listening on port ${env.METRICS_PORT}`);

    const closeListeners = closeWithGrace({ delay: 500 }, async ({ signal, err }) => {
        if (err) logger.error(err);
        logger.info(`\n${signal} signal received. closing HTTP server`);
        await app.close();
        if (policyApp) await policyApp.close();
        await db.close();
        await metricsServer.close();
    });

    app.server.on('close', () => {
        closeListeners.uninstall();
    });
}

/** Never invoked from this module: bundlers inline it, and a self-booting module
 * would start a second server underneath its host. */
export function bootFromCli(features: ServiceFeatures = {}) {
    start(features).catch((err) => {
        logger.error(err);
        Sentry.captureException(err, {
            tags: { service: 'permissions-api' }
        });
        process.exit(1);
    });
}
