import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifySchedule from '@fastify/schedule';
import {
    type CoreFacts,
    createApiServer,
    type FeatureAuditContext,
    type RequestAuthGuards,
    type RpcObserverFactory,
    registerNotFoundHandler
} from '@repo/api-kit';
import type { MetricsServer } from '@repo/api-metrics';
import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { ToadScheduler } from 'toad-scheduler';
import { type Address, createWalletClient, defineChain, type Hex, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RepositoriesCoreFacts } from './core-facts/repositories-core-facts';
import type { Repositories as RepositoriesType } from './db';
import { type DB, Repositories } from './db';
import { TargetTypes } from './db/schema';
import type { Env } from './env';
import { errorHandler } from './error-handler';
import { CoreRequestAuthGuards, featureAuditContextOf, requestAuditClient } from './feature-host/core-request-auth';
import { registerCorsMiddleware, registerSwaggerSpec, registerSwaggerUi } from './middleware';
import { ApiKeyAuthValidator } from './middleware/api-key-auth';
import { createAuditContextMiddleware, registerAuditContextCleanup } from './middleware/audit-context';
import { registerMetricMiddlewares } from './middleware/metrics-middleware';
import {
    actorKeyGenerator,
    actorMax,
    type RateLimitConfig,
    registerGlobalRateLimit,
    registerRateLimitForScope,
    userKeyGenerator
} from './middleware/rate-limit-middleware';
import { registerRequestContextMiddleware } from './middleware/request-context';
import { SessionsAuthValidator } from './middleware/sessions-auth';
import { userAccessControlValidator } from './middleware/user-access-control';
import { createAuthRecordsCleanupJob } from './plugins/auth-records-cleanup-plugin';
import { createDeploymentCleanupJob } from './plugins/deployment-cleanup-plugin';
import { createNonceCleanupJob } from './plugins/nonce-cleanup-plugin';
import { createSessionCleanupJob } from './plugins/session-cleanup-plugin';
import { adminApplicationsRoutes } from './routes/admin-applications-routes';
import { adminFaucetRoutes } from './routes/admin-faucet-routes';
import { adminServicesRoutes } from './routes/admin-services-routes';
import { adminSessionsRoutes } from './routes/admin-sessions-routes';
import { webauthnAdminRoutes } from './routes/admin-webauthn-routes';
import { auditLogsRoutes } from './routes/audit-logs-routes';
import { authRoutes } from './routes/auth-routes';
import { checkRoutes } from './routes/check-routes';
import { contractDeploymentRoutes } from './routes/contract-deployment-routes';
import { contractEventPermissionsRoutes } from './routes/contract-event-permissions-routes';
import { contractPermissionsRoutes } from './routes/contract-permissions-routes';
import { contractsRoutes } from './routes/contracts-routes';
import { docsRoutes } from './routes/docs-routes';
import { dotWellKnownRoutes, type PrividiumInfo } from './routes/dot-well-known-routes';
import { faucetRoutes } from './routes/faucet-routes';
import { healthRoutes } from './routes/health-routes';
import { infoRoutes } from './routes/info-routes';
import { m2mAppApiKeysRoutes } from './routes/m2m-app-api-keys-routes';
import { m2mAppIpWhitelistRoutes } from './routes/m2m-app-ip-whitelist-routes';
import { m2mAppQueriesRoutes } from './routes/m2m-app-queries-routes';
import { m2mAppRoutes } from './routes/m2m-app-routes';
import { organizationsPublicRoutes } from './routes/organizations-public-routes';
import { organizationsRoutes } from './routes/organizations-routes';
import { profilesRoutes } from './routes/profiles-routes';
import { publicApplicationsRoutes } from './routes/public-applications-routes';
import { publicCheckRoutes } from './routes/public-check-routes';
import { rolesRoutes } from './routes/roles-routes';
import { rpcRoutes } from './routes/rpc-routes';
import { serviceActionRoutes } from './routes/service-action-routes';
import { sessionsRoutes } from './routes/sessions-routes';
import { siweMessageRoutes } from './routes/siwe-messages-routes';
import { stepUpRoutes } from './routes/step-up-routes';
import { templatePermissionsRoutes } from './routes/template-permissions-routes';
import { templatesRoutes } from './routes/templates-routes';
import { tenantActions } from './routes/tenant-actions';
import { tenantApiKeysRoutes } from './routes/tenant-api-keys-routes';
import { tenantIpWhitelistRoutes } from './routes/tenant-ip-whitelist-routes';
import { tenantsRoutes } from './routes/tenants-routes';
import { theGraphRoutes } from './routes/the-graph-routes';
import { userApplicationsRoutes } from './routes/user-applications-routes';
import { userContractsRoutes } from './routes/user-contracts-routes';
import { walletAssociationRoutes } from './routes/user-wallets-routes';
import { usersRoutes } from './routes/users-routes';
import { walletActionsRoutes } from './routes/wallet-actions-routes';
import { walletRoutes } from './routes/wallet-token-routes';
import { webauthnUserRoutes } from './routes/webauthn-routes';
import type { DispatcherConfig } from './rpc/methods/dispatchers';
import { type ExternalRpc, TargetRpc } from './rpc/target-rpc';
import { AdminMfaService } from './services/admin-mfa-service';
import { ApiKeyService } from './services/api-key-service';
import { ApplicationsService } from './services/applications-service';
import { AuditLogsService } from './services/audit-logs-service';
import { AuthorizationService } from './services/authorization-service';
import { EventPermissionVerifier } from './services/event-permission-verifier';
import type { FaucetServiceConfig } from './services/faucet-service';
import { HealthCheckService } from './services/health-check-service';
import { type JwksFactory, type JwtValidationData, JwtValidatorService } from './services/jwt-validator-service';
import { M2mAppActionsService } from './services/m2m-app-actions-service';
import { PasskeyService } from './services/passkey-service';
import type { SessionService as SessionServiceType } from './services/session-service';
import { SessionService } from './services/session-service';
import { SiweChallengeService } from './services/siwe-challenge-service';
import { SiweService } from './services/siwe-service';
import { StepUpService } from './services/step-up-service';
import { TenantsService } from './services/tenants-service';
import { TransactionClassifier } from './services/transaction-classifier';
import { createWalletAssociationGuard } from './services/wallet-association-guard';
import { WalletTokenService } from './services/wallet-token-service';
import { WebAuthnService } from './services/webauthn-service';
import type { SiweConfig } from './siwe-config';
import { applyDocsSecurityHeaders } from './utils/docs-security-headers';
import { DOCS_SESSION_COOKIE_NAME, isDocsRequest } from './utils/docs-session';
import type { PinoLogger } from './utils/logger';
import { metricsServer } from './utils/metrics';
import type { TargetChainType } from './utils/target-chain';

function parseDispatcherConfig(config: AppConfig['dispatcherConfig']): DispatcherConfig {
    return {
        allowedBytecodeHashes: config?.ssoBytecodeHashes
            ? new Set(config.ssoBytecodeHashes.map((h) => h.toLowerCase() as Hex))
            : undefined,
        allowedImplementations: config?.ssoImplementations
            ? new Set(config.ssoImplementations.map((a) => a.toLowerCase() as Address))
            : undefined
    };
}

function registerDocsAuthGate(
    app: FastifyServer,
    config: AppConfig,
    sessionAuthValidator: SessionsAuthValidator,
    sessionService: SessionServiceType,
    repos: RepositoriesType
): void {
    const userPanelUrl = config.userPanelUrl;
    if (!userPanelUrl) {
        throw new Error('Swagger UI gate requires USER_PANEL_URL (or a single-valued WEBAUTHN_ORIGIN)');
    }

    docsRoutes(app, {
        repos,
        sessionService,
        allowedRoles: config.swaggerUiAllowedRoles,
        userPanelUrl
    });

    registerSwaggerUi(app, async (request, reply) => {
        if (!isDocsRequest(request)) return;
        const token = request.cookies?.[DOCS_SESSION_COOKIE_NAME];
        if (!token) {
            reply.redirect('/docs/login');
            return;
        }
        // Cookie fallback in sessions-auth picks up the token; the hook validates role.
        try {
            await sessionAuthValidator.buildHook({
                targets: [{ type: 'user', requiredRoles: config.swaggerUiAllowedRoles }]
            })(request);
        } catch {
            reply.clearCookie(DOCS_SESSION_COOKIE_NAME, { path: '/docs' });
            reply.redirect('/docs/login');
            return;
        }
        applyDocsSecurityHeaders(reply);
    });
}

function buildFastify({ logger, trustXForwardedFor }: { logger: PinoLogger; trustXForwardedFor?: string[] }) {
    // Single value: pass as string so Fastify supports CIDR notation (e.g. "10.42.0.0/16")
    // Multiple values: pass as array for exact IP matching
    const trustProxy = trustXForwardedFor?.length === 1 ? trustXForwardedFor[0] : trustXForwardedFor;
    return createApiServer({ logger, trustProxy });
}

export type FastifyServer = ReturnType<typeof buildFastify>;

declare module 'fastify' {
    interface FastifyRequest {
        metricsStartTime: number;
        metricPathName: string;
        metricApiHandlerRole?: string;
    }
}

/** The core names no feature and imports none; a composition root outside this
 * tree does the wiring. */
export type FeatureContext = {
    guards: RequestAuthGuards;
    auditContextOf: (request: FastifyRequest) => FeatureAuditContext;
    /**
     * The projection of core data a feature may read, bound to this request's
     * connection so its reads share the request's audit context.
     */
    coreFactsFor: (request: FastifyRequest) => CoreFacts;
    /** Bind a feature's schema to *this*, not the pool: the audit vars are session-level
     * on one client, so a pool-bound write lands unattributed. */
    clientFor: (request: FastifyRequest) => PoolClient;
    /** A second `MetricsServer` produces a registry nothing listens on. */
    metrics: MetricsServer;
    /** For work outside any request: a background job, a per-request observer's flush. */
    pool: Pool;
    /** The sequencer the core proxies to, for a feature that has to read chain state. */
    chainRpc: ExternalRpc;
    /** The core's scheduler; a job added here stops with the app. */
    scheduler: ToadScheduler;
    logger: PinoLogger;
};

/** Boot-time view for a feature hook that runs outside any request. */
export type FeatureRuntime = {
    pool: Pool;
    coreFacts: CoreFacts;
    metrics: MetricsServer;
    logger: PinoLogger;
};

export interface AppConfig {
    /**
     * Called once, after the core's own routes and middleware are registered, so a
     * private feature can mount routes on this instance. Absent in the open core's
     * own entrypoint, which has no features to register.
     */
    registerFeatures?: (app: FastifyServer, context: FeatureContext) => void | Promise<void>;
    /** Published on `GET /info` so a panel gates on what this server registered, not its own build flag. */
    featureNames?: readonly string[];
    /** Consulted once per RPC request; `undefined` leaves that request unobserved. */
    rpcObserverFor?: RpcObserverFactory;
    targetRpcUrl: string;
    targetChainType: TargetChainType;
    logger: PinoLogger;
    corsOrigins?: string[];
    authMethods: Env['AUTH_METHODS'];
    oidcOpts?: JwtValidationData;
    /** Test seam: override how per-org OIDC provider JWKS are resolved (default fetches jwksUri). */
    jwksFactory?: JwksFactory;
    siwe: SiweConfig;
    adminOidcSubs: string[];
    adminWallets: string[];
    userSessionDurationSeconds: number;
    tenantSessionDurationSeconds: number;
    serviceSessionDurationSeconds: number;
    /** When set, user sessions use a sliding idle deadline. Unset = feature OFF. */
    userIdleTimeoutSeconds?: number;
    healthCheckIntervalMs: number;
    oauthRedirectUrls: {
        adminPanel: string[];
        blockExplorer: string[];
        swaggerDocs?: string[];
    };
    userPanelUrl?: string;
    swaggerUiAllowedRoles: string[];
    corsCacheDurationMs: number;
    // Bundler config
    bundlerEnabled?: boolean;
    bundlerRpcUrl?: string;
    theGraphApiEnabled?: boolean;
    theGraphApiUrl?: string;
    faucet?: {
        operatorPrivateKey: Hex;
        claimAmountWei: bigint;
        cooldownSeconds: number;
        stalePendingSeconds: number;
        maxDailySpendWei: bigint;
        txTimeoutMs: number;
    };
    dispatcherConfig?: {
        ssoBytecodeHashes?: string[];
        ssoImplementations?: string[];
    };
    walletRpcEnabled: boolean;
    tenantsEnabled: boolean;
    multiOrgEnabled: boolean;
    orgRoutingByDomain: boolean;
    maxOrganizations: number;
    maxWalletsPerUser: number;
    auditLogsPaginationMaxItems: number;
    insecureM2mAllowAnyIp: boolean;
    webauthn: {
        rpName: string;
        rpId: string;
        origins: string[];
        requireUserVerification: boolean;
        authenticatorAttachment?: 'platform' | 'cross-platform';
    };
    trustXForwardedFor?: string[];
    apiKeyMaxExpirationSeconds: number;
    // Basic data for these addresses can be queried (code, nonce, balance)
    publicCodeAddresses: Address[];
    // Allowlist of dev EOAs that bypass the well-known dev wallet block.
    // Empty (default) in production; populated in local-dev / test envs.
    knownDevWalletsAllowlist: Address[];
    disclosureMethodsEnabled: boolean;
    brandName: string;
    version: string;
    rateLimit?: RateLimitConfig;
    /** Whether the policy listener (`/admit` + `/judge`) is mounted. Drives
     * full-sequencer-access eth_call's rewrite-to-debug_traceCall: when
     * disabled, eth_call forwards as-is (pre-policy-feature behavior). */
    policyEnabled: boolean;
    deploymentCleanup: {
        pendingTtlSeconds: number;
        erroredRetentionSeconds: number;
        intervalSeconds: number;
    };
    prividiumInfo: PrividiumInfo;
}

export async function buildApp(db: DB, config: AppConfig) {
    const app = buildFastify({ logger: config.logger, trustXForwardedFor: config.trustXForwardedFor });

    const healthCheckService = new HealthCheckService({
        db,
        logger: config.logger,
        intervalMs: config.healthCheckIntervalMs,
        version: config.version
    });
    await healthCheckService.start();
    app.addHook('onClose', async () => {
        healthCheckService.stop();
    });

    const repos = new Repositories(db);
    const applicationsService = new ApplicationsService(repos, {
        adminPanelRedirectUris: config.oauthRedirectUrls.adminPanel,
        blockExplorerRedirectUris: config.oauthRedirectUrls.blockExplorer,
        swaggerDocsRedirectUris: config.oauthRedirectUrls.swaggerDocs ?? [],
        cacheDurationMs: config.corsCacheDurationMs
    });

    const { targetChainType } = config;
    const chainRpc = new TargetRpc(config.targetRpcUrl || 'fix-openapi-generation', targetChainType);
    const viemPublicClient = chainRpc.viemPublicClient();

    // Faucet operator — only instantiated when the feature is enabled
    let faucetWalletClient: WalletClient | undefined;
    let faucetServiceConfig: FaucetServiceConfig | undefined;
    if (config.faucet) {
        const operatorAccount = privateKeyToAccount(config.faucet.operatorPrivateKey);
        const faucetRpcUrl = config.targetRpcUrl || 'http://fix-openapi-generation';
        // Pinning the chain on construction avoids a per-call eth_chainId round-trip
        // and surfaces chain mismatches at startup rather than at first send. Faucet
        // ETH is dispensed on the same L2 users sign in for, so siwe.chainId applies.
        const faucetChain = defineChain({
            id: config.siwe.chainId,
            name: 'faucet-target',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: { default: { http: [faucetRpcUrl] } }
        });
        faucetWalletClient = createWalletClient({
            account: operatorAccount,
            chain: faucetChain,
            transport: http(faucetRpcUrl)
        });
        faucetServiceConfig = {
            claimAmountWei: config.faucet.claimAmountWei,
            cooldownSeconds: config.faucet.cooldownSeconds,
            stalePendingSeconds: config.faucet.stalePendingSeconds,
            maxDailySpendWei: config.faucet.maxDailySpendWei,
            txTimeoutMs: config.faucet.txTimeoutMs,
            operatorAddress: operatorAccount.address
        };
    }

    const auditLogsService = new AuditLogsService(repos);
    const eventPermissionVerifier = new EventPermissionVerifier(repos, config.multiOrgEnabled);

    // ------------------------------------------------------------
    // Scheduled checks
    // ------------------------------------------------------------

    void app.register(fastifySchedule);

    app.after(() => {
        app.scheduler.addSimpleIntervalJob(
            createNonceCleanupJob({
                repos,
                logger: config.logger,
                consumedNonceTtlSeconds: config.siwe.consumedNonceTtlSeconds,
                challengeLogTtlSeconds: config.siwe.challengeRateLimitWindowSeconds,
                intervalSeconds: config.siwe.cleanupIntervalSeconds
            })
        );
        app.scheduler.addSimpleIntervalJob(
            createSessionCleanupJob({
                repos,
                logger: config.logger,
                intervalSeconds: config.siwe.cleanupIntervalSeconds
            })
        );
        app.scheduler.addSimpleIntervalJob(
            createAuthRecordsCleanupJob({
                repos,
                logger: config.logger,
                intervalSeconds: config.siwe.cleanupIntervalSeconds
            })
        );
        app.scheduler.addSimpleIntervalJob(
            createDeploymentCleanupJob({
                db,
                chainRpc,
                logger: config.logger,
                pendingTtlSeconds: config.deploymentCleanup.pendingTtlSeconds,
                erroredRetentionSeconds: config.deploymentCleanup.erroredRetentionSeconds,
                intervalSeconds: config.deploymentCleanup.intervalSeconds
            })
        );
    });

    // ------------------------------------------------------------
    // Services
    // ------------------------------------------------------------
    const siweService = new SiweService({
        repos: repos,
        chainId: config.siwe.chainId,
        hmacSecret: config.siwe.hmacSecret,
        logger: config.logger.child({ role: 'SiweService' })
    });
    const siweChallengeService = new SiweChallengeService({
        repos,
        expirationDeltaMs: config.siwe.expirationMs,
        chainId: config.siwe.chainId,
        validDomains: config.siwe.validDomains,
        adminWallets: config.adminWallets,
        challengeRateLimitCount: config.siwe.challengeRateLimitCount,
        challengeRateLimitWindowSeconds: config.siwe.challengeRateLimitWindowSeconds,
        rateLimitBypassIps: config.siwe.rateLimitBypassIps,
        siweService,
        brandName: config.brandName,
        multiOrgEnabled: config.multiOrgEnabled
    });
    const apiKeyService = new ApiKeyService();
    const apiKeyAuthValidator = new ApiKeyAuthValidator({
        logger: config.logger.child({ role: 'ApiKeyAuthValidator' }),
        apiKeyService,
        repos,
        auditLogsService
    });
    const sessionAuthValidator = new SessionsAuthValidator({
        logger: config.logger.child({ role: 'SessionsAuthValidator' }),
        repos,
        apiKeyAuthValidator
    });
    const sessionService = new SessionService({
        repos,
        opts: {
            userSessionDurationSeconds: config.userSessionDurationSeconds,
            tenantSessionDurationSeconds: config.tenantSessionDurationSeconds,
            serviceSessionDurationSeconds: config.serviceSessionDurationSeconds,
            userIdleTimeoutSeconds: config.userIdleTimeoutSeconds
        }
    });
    const jwtValidatorService = new JwtValidatorService({
        logger: config.logger.child({ role: 'JwtValidatorService' }),
        oidcOpts: config.oidcOpts,
        repos,
        adminOidcSubs: config.adminOidcSubs,
        multiOrgEnabled: config.multiOrgEnabled,
        jwksFactory: config.jwksFactory
    });
    const walletTokenService = new WalletTokenService();
    const authorizationService = new AuthorizationService({ repos, multiOrgEnabled: config.multiOrgEnabled });
    const transactionClassifier = new TransactionClassifier(chainRpc);
    const walletAssociationGuard = createWalletAssociationGuard(config.knownDevWalletsAllowlist);
    if (config.knownDevWalletsAllowlist.length > 0) {
        config.logger.warn(
            { allowlistSize: config.knownDevWalletsAllowlist.length },
            'KNOWN_DEV_WALLETS_ALLOWLIST is non-empty — well-known dev wallet block is partially bypassed. This MUST be empty in production.'
        );
    }
    const tenantsService = new TenantsService(repos, chainRpc, walletAssociationGuard, config.maxWalletsPerUser);
    const m2mAppActionsService = new M2mAppActionsService({
        repos,
        rpc: chainRpc,
        walletAssociationGuard,
        maxWalletsPerUser: config.maxWalletsPerUser,
        multiOrgEnabled: config.multiOrgEnabled
    });
    const webauthnService = new WebAuthnService(config.webauthn);
    const passkeyService = new PasskeyService({
        webauthnService,
        repos
    });
    const adminMfaService = new AdminMfaService({
        passkeyService,
        repos
    });
    const stepUpService = new StepUpService({
        passkeyService,
        repos
    });

    // ------------------------------------------------------------
    // Register middleware
    // ------------------------------------------------------------
    app.register(fastifyCookie);
    registerSwaggerSpec(app, config);
    if (config.swaggerUiAllowedRoles.length > 0) {
        registerDocsAuthGate(app, config, sessionAuthValidator, sessionService, repos);
    }
    registerRequestContextMiddleware(app, repos);
    registerMetricMiddlewares(app);
    registerAuditContextCleanup(app);

    app.register(
        (app) => {
            registerCorsMiddleware(app, config.corsOrigins ?? [], applicationsService);

            // ------------------------------------------------------------
            // Admin routes
            // ------------------------------------------------------------
            app.register((app) => {
                app.addHook(
                    'onRequest',
                    sessionAuthValidator.buildHook((request) => ({
                        targets: [
                            {
                                type: 'user',
                                ...(request.method === 'GET'
                                    ? { requiredSystemPermissions: ['admin_read'] }
                                    : { requiredSystemPermissions: ['admin_write'] })
                            }
                        ]
                    }))
                );
                app.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));

                app.register(rolesRoutes, { prefix: '/roles', multiOrgEnabled: config.multiOrgEnabled });
                app.register(usersRoutes, {
                    prefix: '/users',
                    walletAssociationGuard,
                    maxWalletsPerUser: config.maxWalletsPerUser,
                    multiOrgEnabled: config.multiOrgEnabled
                });
                app.register(contractsRoutes, { prefix: '/contracts', chainRpc });
                app.register(contractPermissionsRoutes, {
                    prefix: '/contract-permissions',
                    multiOrgEnabled: config.multiOrgEnabled
                });
                app.register(contractDeploymentRoutes, { prefix: '/contract-deployments' });
                app.register(templatesRoutes, { prefix: '/templates' });
                app.register(templatePermissionsRoutes, {
                    prefix: '/template-permissions',
                    multiOrgEnabled: config.multiOrgEnabled
                });
                app.register(contractEventPermissionsRoutes, {
                    prefix: '/event-permissions',
                    multiOrgEnabled: config.multiOrgEnabled
                });
                if (config.tenantsEnabled) {
                    app.register(tenantsRoutes, { prefix: '/tenants' });
                    app.register(tenantApiKeysRoutes, {
                        prefix: '/tenants',
                        apiKeyService,
                        apiKeyMaxExpirationSeconds: config.apiKeyMaxExpirationSeconds
                    });
                    app.register(tenantIpWhitelistRoutes, { prefix: '/tenants' });
                }
                app.register(m2mAppRoutes, {
                    prefix: '/m2m-applications'
                });
                app.register(m2mAppApiKeysRoutes, {
                    prefix: '/m2m-applications',
                    apiKeyService,
                    apiKeyMaxExpirationSeconds: config.apiKeyMaxExpirationSeconds
                });
                app.register(m2mAppIpWhitelistRoutes, {
                    prefix: '/m2m-applications',
                    allowAnyCidr: config.insecureM2mAllowAnyIp
                });
                app.register(auditLogsRoutes, {
                    prefix: '/audit-logs',
                    paginationMaxItems: config.auditLogsPaginationMaxItems
                });
                app.register(adminApplicationsRoutes, { prefix: '/applications', applicationsService });
                app.register(adminSessionsRoutes, { prefix: '/admin/sessions' });
                app.register(adminServicesRoutes, { prefix: '/admin/services' });
                app.register(webauthnAdminRoutes, { prefix: '/admin/webauthn', stepUpService });
                app.register(webauthnUserRoutes, {
                    passkeyService,
                    stepUpService
                });
                app.register(stepUpRoutes, { stepUpService });
                if (faucetWalletClient && faucetServiceConfig) {
                    app.register(adminFaucetRoutes, {
                        prefix: '/admin/faucet',
                        publicClient: viemPublicClient,
                        walletClient: faucetWalletClient,
                        config: faucetServiceConfig
                    });
                }
            });

            // ------------------------------------------------------------
            // User routes
            // ------------------------------------------------------------
            app.register(async (app) => {
                app.addHook(
                    'onRequest',
                    sessionAuthValidator.buildHook({ targets: [{ type: TargetTypes.enum.user }] })
                );
                app.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
                app.register(userAccessControlValidator);
                if (config.rateLimit) {
                    registerGlobalRateLimit(app, config.rateLimit, {
                        max: config.rateLimit.user.max,
                        keyGenerator: userKeyGenerator
                    });
                }
                app.register(profilesRoutes, {
                    prefix: '/profiles'
                });
                app.register(walletAssociationRoutes, {
                    prefix: '/user-wallets',
                    siweChallengeService,
                    siweService,
                    rpcClient: viemPublicClient,
                    chainRpc,
                    walletAssociationGuard,
                    maxWalletsPerUser: config.maxWalletsPerUser
                });
                app.register(sessionsRoutes, { prefix: '/sessions' });
                app.register(checkRoutes, {
                    prefix: '/check',
                    eventVerifier: eventPermissionVerifier
                });
                app.register(userApplicationsRoutes, {
                    prefix: '/public-applications',
                    applicationsService
                });
                app.register(userContractsRoutes, {
                    prefix: '/contracts',
                    repos,
                    multiOrgEnabled: config.multiOrgEnabled
                });
                if (config.walletRpcEnabled) {
                    app.register(walletRoutes, {
                        prefix: '/wallet',
                        walletTokenService,
                        authorizationService,
                        transactionClassifier
                    });
                }
                if (faucetWalletClient && faucetServiceConfig) {
                    app.register(faucetRoutes, {
                        prefix: '/faucet',
                        publicClient: viemPublicClient,
                        walletClient: faucetWalletClient,
                        config: faucetServiceConfig
                    });
                }
            });

            // ------------------------------------------------------------
            // Organization routes
            // ------------------------------------------------------------
            app.register((app) => {
                app.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
                app.register(organizationsRoutes, {
                    prefix: '/organizations',
                    sessionAuthValidator,
                    m2mAppActionsService,
                    chainRpc,
                    apiKeyService,
                    apiKeyMaxExpirationSeconds: config.apiKeyMaxExpirationSeconds,
                    insecureM2mAllowAnyIp: config.insecureM2mAllowAnyIp,
                    operatorIssuer: config.oidcOpts?.iss,
                    maxOrganizations: config.maxOrganizations,
                    multiOrgEnabled: config.multiOrgEnabled
                });
            });

            // ------------------------------------------------------------
            // M2M application query routes
            // ------------------------------------------------------------
            app.register((app) => {
                app.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
                if (config.rateLimit) {
                    registerGlobalRateLimit(app, config.rateLimit, {
                        max: config.rateLimit.m2m.max,
                        keyGenerator: actorKeyGenerator,
                        hook: 'preHandler'
                    });
                }
                app.register(m2mAppQueriesRoutes, {
                    prefix: '/m2m-app-queries',
                    sessionAuthValidator
                });
            });

            // ------------------------------------------------------------
            // Tenant routes
            // ------------------------------------------------------------
            if (config.tenantsEnabled) {
                app.register((app) => {
                    app.addHook('onRequest', sessionAuthValidator.buildHook({ targets: [{ type: 'tenant' }] }));
                    app.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
                    app.register(tenantActions, { prefix: '/tenant-actions', tenantsService });
                });
            }

            // ------------------------------------------------------------
            // Service routes
            // ------------------------------------------------------------
            app.register((app) => {
                app.addHook(
                    'onRequest',
                    sessionAuthValidator.buildHook({
                        targets: [{ type: TargetTypes.enum.service }]
                    })
                );
                app.register(serviceActionRoutes, { prefix: '/service-actions' });
            });

            // ------------------------------------------------------------
            // Public routes
            // ------------------------------------------------------------
            app.register(async (app) => {
                if (config.rateLimit?.enabled) {
                    await registerRateLimitForScope(app, {
                        max: config.rateLimit.auth.max,
                        timeWindow: config.rateLimit.windowMs
                    });
                }
                app.register(authRoutes, {
                    prefix: '/auth',
                    sessionService,
                    sessionAuthValidator,
                    siweService,
                    jwtValidatorService,
                    auditLogsService,
                    adminMfaService,
                    tenantsEnabled: config.tenantsEnabled
                });
            });
            if (config.authMethods.includes('crypto_native')) {
                app.register(async (app) => {
                    if (config.rateLimit?.enabled) {
                        await registerRateLimitForScope(app, {
                            max: config.rateLimit.auth.max,
                            timeWindow: config.rateLimit.windowMs
                        });
                    }
                    app.register(siweMessageRoutes, {
                        prefix: '/siwe-messages',
                        siweChallengeService,
                        auditLogsService,
                        tenantsEnabled: config.tenantsEnabled
                    });
                    app.register(publicApplicationsRoutes, { prefix: '/oauth-clients', applicationsService });
                });
            }
            app.register(async (app) => {
                if (config.rateLimit?.enabled) {
                    await registerRateLimitForScope(app, {
                        max: config.rateLimit.public.max,
                        timeWindow: config.rateLimit.windowMs
                    });
                }
                app.register(publicCheckRoutes, { prefix: '/public-check' });
                app.register(infoRoutes, {
                    prefix: '/info',
                    policyEnabled: config.policyEnabled,
                    features: config.featureNames ?? [],
                    multiOrgEnabled: config.multiOrgEnabled,
                    orgRoutingByDomain: config.orgRoutingByDomain
                });
                app.register(organizationsPublicRoutes, {
                    prefix: '/organizations',
                    multiOrgEnabled: config.multiOrgEnabled
                });
                app.register(walletActionsRoutes, {
                    prefix: '/wallet-actions',
                    authorizationService,
                    transactionClassifier,
                    auditContextMiddleware: createAuditContextMiddleware(auditLogsService, db)
                });
            });

            // Registered last so features inherit `/api` and cannot shadow a core route.
            const registerFeatures = config.registerFeatures;
            if (registerFeatures !== undefined) {
                app.register(async (scope) => {
                    scope.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
                    // A feature route may open a transaction and take a lock, so an
                    // unmetered caller can occupy connections. Keyed per actor, on
                    // `preHandler` because the key needs the authenticated identity.
                    if (config.rateLimit) {
                        registerGlobalRateLimit(scope, config.rateLimit, {
                            max: actorMax(config.rateLimit),
                            keyGenerator: actorKeyGenerator,
                            hook: 'preHandler'
                        });
                    }
                    // Fastify instance generics are invariant, so this cast is unavoidable.
                    await registerFeatures(scope as unknown as FastifyServer, {
                        guards: new CoreRequestAuthGuards({ sessionAuthValidator }),
                        auditContextOf: featureAuditContextOf,
                        coreFactsFor: (request) => new RepositoriesCoreFacts({ repos: request.repos }),
                        clientFor: requestAuditClient,
                        metrics: metricsServer,
                        pool: db.$client,
                        chainRpc,
                        scheduler: app.scheduler,
                        logger: config.logger
                    });
                });
            }
        },
        {
            prefix: '/api'
        }
    );

    // ------------------------------------------------------------
    // Rpc routes
    // ------------------------------------------------------------
    app.register(async (app) => {
        app.addHook('onRequest', async (request, _reply) => {
            request.headers['content-type'] = 'application/json';
        });
        app.addHook(
            'preHandler',
            sessionAuthValidator.buildHook({
                targets: [
                    { type: 'user', requiredRoles: [] },
                    ...(config.tenantsEnabled ? ([{ type: 'tenant' }] as const) : []),
                    { type: 'm2m_app' },
                    { type: 'service' },
                    { type: 'anonymous' }
                ]
            })
        );
        if (config.rateLimit) {
            registerGlobalRateLimit(app, config.rateLimit, {
                max: actorMax(config.rateLimit),
                keyGenerator: actorKeyGenerator,
                hook: 'preHandler'
            });
        }
        app.register(rpcRoutes, {
            prefix: '/rpc',
            targetRpcUrl: config.targetRpcUrl,
            targetChainType,
            methodAuthService: authorizationService,
            sessionAuthValidator,
            eventVerifier: eventPermissionVerifier,
            bundlerEnabled: config.bundlerEnabled ?? false,
            bundlerRpcUrl: config.bundlerRpcUrl,
            dispatcherConfig: parseDispatcherConfig(config.dispatcherConfig),
            transactionClassifier,
            walletRpcEnabled: config.walletRpcEnabled,
            publicCodeAddresses: config.publicCodeAddresses,
            disclosureMethodsEnabled: config.disclosureMethodsEnabled,
            policyEnabled: config.policyEnabled,
            ...(config.rpcObserverFor === undefined ? {} : { rpcObserverFor: config.rpcObserverFor })
        });
    });

    app.register(healthRoutes, { prefix: '/', healthCheckService });

    // Prefix on the wrapper, not the inner plugin: @fastify/cors registers a catch-all
    // `OPTIONS *` at the encapsulation prefix, so an un-prefixed wrapper collides with the
    // subgraph cors below (FST_ERR_DUPLICATED_ROUTE).
    app.register(
        (app) => {
            app.register(cors, {
                origin: ['*'],
                methods: ['GET']
            });
            app.register(dotWellKnownRoutes, { prividiumInfo: config.prividiumInfo });
        },
        { prefix: '/.well-known' }
    );

    // /admit and /judge live on a separate mTLS-only listener — see
    // `build-policy-app.ts` and `index.ts`. They are intentionally not
    // mounted on this app: the user-facing routes here use SIWE/JWT auth,
    // not client certificates, so the two transport postures don't share a
    // listener.

    // ------------------------------------------------------------
    // The Graph proxy (admin only)
    // ------------------------------------------------------------
    if (config.theGraphApiEnabled && config.theGraphApiUrl) {
        const theGraphApiUrl = config.theGraphApiUrl;
        app.register(
            (app) => {
                app.register(cors, {
                    origin: true,
                    methods: ['GET', 'POST'],
                    allowedHeaders: ['Content-Type', 'Authorization'],
                    credentials: true
                });
                app.addHook(
                    'onRequest',
                    sessionAuthValidator.buildHook({
                        targets: [{ type: 'user', requiredSystemPermissions: ['admin_write'] }]
                    })
                );
                app.register(theGraphRoutes, {
                    theGraphApiUrl
                });
            },
            { prefix: '/subgraph' }
        );
    }

    app.addHook('onSend', async (_request, reply) => {
        reply.header('X-Content-Type-Options', 'nosniff');
    });

    registerNotFoundHandler(app);

    app.setErrorHandler(errorHandler);

    return app;
}

export type WebServer = Awaited<ReturnType<typeof buildApp>>;
