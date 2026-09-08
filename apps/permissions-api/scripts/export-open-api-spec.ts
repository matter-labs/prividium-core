import * as fs from 'node:fs';
import path from 'node:path';
import { pino } from 'pino';
import { type AppConfig, buildApp } from '../src/build-app';

// Mock dependencies - we just need the app structure to generate the OpenAPI spec
const mockDeps = {
    logger: pino({ level: 'silent' }),
    healthCheckIntervalMs: 1_000,
    siwe: {
        chainId: 6565,
        expirationMs: 60_000,
        validDomains: ['localhost:3000'],
        challengeRateLimitCount: 10,
        challengeRateLimitWindowSeconds: 5 * 60,
        consumedNonceTtlSeconds: 600,
        cleanupIntervalSeconds: 60,
        rateLimitBypassIps: ['127.0.0.1', '::1']
    },
    adminOidcSubs: [],
    adminWallets: [],
    authMethods: ['crypto_native', 'oidc'],
    targetRpcUrl: '',
    targetChainType: 'zksync-os',
    oauthRedirectUrls: {
        adminPanel: [''],
        blockExplorer: ['']
    },
    swaggerUiAllowedRoles: [],
    userSessionDurationSeconds: 10,
    tenantSessionDurationSeconds: 10,
    corsCacheDurationMs: 10,
    serviceSessionDurationSeconds: 100,
    walletRpcEnabled: true,
    tenantsEnabled: true,
    webauthn: {
        origins: ['http://localhost:3001'],
        rpName: 'ZKsync Prividium',
        rpId: 'localhost',
        requireUserVerification: false
    },
    trustXForwardedFor: undefined,
    apiKeyMaxExpirationSeconds: 365 * 24 * 60 * 60, // 1 year
    publicCodeAddresses: [],
    knownDevWalletsAllowlist: [],
    disclosureMethodsEnabled: true,
    multiOrgEnabled: true,
    orgRoutingByDomain: false,
    maxOrganizations: 100,
    maxWalletsPerUser: 100,
    auditLogsPaginationMaxItems: 10_000,
    insecureM2mAllowAnyIp: false,
    brandName: 'Prividium™',
    version: 'local-dev',
    faucet: {
        // Anvil account #3, only used here so the faucet routes register and appear in the
        // exported OpenAPI spec. The app instance is discarded immediately.
        operatorPrivateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
        claimAmountWei: 1n,
        cooldownSeconds: 1,
        stalePendingSeconds: 1,
        maxDailySpendWei: 0n,
        txTimeoutMs: 1000
    },
    policyEnabled: false,
    deploymentCleanup: {
        pendingTtlSeconds: 3600,
        erroredRetentionSeconds: 604800,
        intervalSeconds: 300
    },
    prividiumInfo: {
        blockExplorerUrl: 'http://localhost:3010',
        chainId: '0x19a5',
        chainName: 'local-dev',
        baseToken: { name: 'Ether', symbol: 'ETH', decimals: 18, l1Address: null },
        rpcUrl: 'http://localhost:8000/rpc',
        userPanelUrl: 'http://localhost:3001',
        version: 'local-dev',
        l1ChainId: '0x7a69',
        l1ChainName: 'Anvil Localhost'
    }
} satisfies AppConfig;

async function main() {
    console.log('exporting open api spec...');
    const targetPath = path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'api-types',
        'permissions-api',
        'spec',
        'openapi-spec.json'
    );
    const app = await buildApp(null as never, mockDeps);
    await app.ready();

    const openApiSpec = app.swagger();

    // Ensure directory exists
    fs.mkdirSync(path.parse(targetPath).dir, { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(openApiSpec, null, 2));

    await app.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
