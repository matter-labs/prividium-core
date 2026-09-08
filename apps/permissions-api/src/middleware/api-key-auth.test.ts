import Fastify from 'fastify';
import pino from 'pino';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { apiKeysTable, m2mApplicationsTable, TargetTypes, tenantsTable } from '../db/schema';
import { ApiKeysRepository } from '../repositories/api-keys-repository';
import { AuditLogsRepository } from '../repositories/audit-logs-repository';
import { IpWhitelistRepository } from '../repositories/ip-whitelist-repository';
import { type Tenant, TenantsRepository } from '../repositories/tenants-repository';
import { ApiKeyService } from '../services/api-key-service';
import { AuditLogsService } from '../services/audit-logs-service';
import { API_KEY_HEADER, ApiKeyAuthValidator } from './api-key-auth';

describe('ApiKeyAuthValidator', () => {
    let validator: ApiKeyAuthValidator;
    let apiKeysRepo: ApiKeysRepository;
    let ipWhitelistRepo: IpWhitelistRepository;
    let tenantsRepo: TenantsRepository;
    let auditLogsRepo: AuditLogsRepository;
    let apiKeyService: ApiKeyService;
    let auditLogsService: AuditLogsService;
    let tenant: Tenant;
    let m2mAppId: string;

    const silence = pino({ level: 'silent' });

    beforeEach<Fixture>(async ({ db }) => {
        auditLogsService = new AuditLogsService(new Repositories(db));

        tenantsRepo = new TenantsRepository(db);
        apiKeysRepo = new ApiKeysRepository(db);
        ipWhitelistRepo = new IpWhitelistRepository(db);
        auditLogsRepo = new AuditLogsRepository(db);
        apiKeyService = new ApiKeyService();

        validator = new ApiKeyAuthValidator({
            logger: silence,
            apiKeyService,
            repos: new Repositories(db),
            auditLogsService
        });

        // Create test tenant
        const walletPrivateKey = generatePrivateKey();
        const walletAddress = privateKeyToAddress(walletPrivateKey);
        tenant = await tenantsRepo.create({
            name: 'Test Tenant',
            publicKey: walletAddress,
            defaultRoles: []
        });

        m2mAppId = 'm2m-app-1';
        await db.insert(m2mApplicationsTable).values({
            id: m2mAppId,
            name: 'Test M2M App'
        });
    });

    describe('buildHook - header extraction', () => {
        it('should throw UnauthorizedError when X-API-Key header is missing', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {}
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Missing API key');
        });

        it('should throw UnauthorizedError when X-API-Key header is empty', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: ''
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Missing API key');
        });

        it('should throw UnauthorizedError when multiple X-API-Key headers are provided', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: ['key1', 'key2']
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });
    });

    describe('buildHook - key format validation', () => {
        it('should throw UnauthorizedError when API key has invalid format', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: 'invalid-key-format'
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should throw UnauthorizedError when API key has wrong prefix', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    // Wrong prefix (should be priv_sk_)
                    [API_KEY_HEADER]: `wrong_sk_${'a'.repeat(64)}`
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should throw UnauthorizedError when API key is too short', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: 'priv_sk_tooshort'
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });
    });

    describe('buildHook - key lookup', () => {
        it('should throw UnauthorizedError when API key is not found in database', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            // Valid format but not in database
            const validFormatKey = `priv_sk_${'a'.repeat(64)}`;

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: validFormatKey
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should throw UnauthorizedError when API key is revoked', async () => {
            // Create and revoke an API key
            const generated = apiKeyService.generate();
            const apiKey = await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Revoked Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000) // 1 day from now
            });

            // Revoke the key
            await apiKeysRepo.revoke(apiKey.id, tenant.id);

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should treat an expired API key as invalid because it is not active', async ({ db }) => {
            const generated = apiKeyService.generate();

            // We need to insert directly to create an already-expired key
            // since the repository validation prevents creating expired keys
            const yesterday = new Date(Date.now() - 86400000);

            // Insert directly into the database to bypass validation
            await db.insert(apiKeysTable).values({
                tenantId: tenant.id,
                name: 'Expired Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: yesterday
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should reject a tenant API key on an m2m_app route', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Tenant Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Tenant IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('m2m_app'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should reject an m2m_app API key on a tenant route', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                m2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                m2mAppId,
                ipAddress: '127.0.0.1',
                description: 'M2M IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });
    });

    describe('buildHook - IP whitelist', () => {
        it('should throw UnauthorizedError when IP is not in whitelist', async () => {
            // Create a valid API key
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            // Add a different IP to whitelist
            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '10.0.0.1',
                description: 'Different IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            // Request comes from 127.0.0.1 by default in Fastify inject
            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            // Returns 401 to avoid revealing whether the key is valid when IP is blocked
            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should reject when whitelist is empty', async () => {
            // Create a valid API key with no whitelist entries
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            // Empty whitelist means no IPs are allowed - returns 401 to avoid revealing key validity
            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });

        it('should not use tenant whitelist entries when authenticating an m2m app', async ({ db }) => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                m2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            const shadowTenantPrivateKey = generatePrivateKey();
            const shadowTenantAddress = privateKeyToAddress(shadowTenantPrivateKey);

            await db.insert(tenantsTable).values({
                id: m2mAppId,
                name: 'Shadow Tenant',
                publicKey: shadowTenantAddress
            });

            await ipWhitelistRepo.create({
                tenantId: m2mAppId,
                ipAddress: '127.0.0.1',
                description: 'Tenant whitelist entry with matching id'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('m2m_app'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid API key');
        });
    });

    describe('buildHook - successful authentication', () => {
        it('should authenticate successfully with valid API key and whitelisted IP', async () => {
            // Create a valid API key
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            // Add the request IP to whitelist (127.0.0.1 is default for Fastify inject)
            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (req, reply) => {
                const currentTenant = req.auth.currentTenant();
                return reply.send({
                    tenantId: currentTenant.id,
                    tenantName: currentTenant.name,
                    type: req.auth.type,
                    authMethod: req.auth.authMethod,
                    isApiKeyAuth: req.auth.isApiKeyAuth,
                    isSessionAuth: req.auth.isSessionAuth
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.tenantId).toEqual(tenant.id);
            expect(body.tenantName).toEqual('Test Tenant');
            expect(body.type).toBe(TargetTypes.enum.tenant);
            expect(body.authMethod).toBe('api_key');
            expect(body.isApiKeyAuth).toBe(true);
            expect(body.isSessionAuth).toBe(false);
        });

        it('should authenticate an m2m app with a valid API key and whitelisted IP', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                m2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                m2mAppId,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('m2m_app'));
            app.get('/test', async (req, reply) => {
                const currentM2mApp = req.auth.currentM2mApp();
                return reply.send({
                    m2mAppId: currentM2mApp.id,
                    m2mAppName: currentM2mApp.name,
                    type: req.auth.type,
                    authMethod: req.auth.authMethod
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json()).toEqual({
                m2mAppId,
                m2mAppName: 'Test M2M App',
                type: 'm2m_app',
                authMethod: 'api_key'
            });
        });

        it('should provide access to currentApiKeyId()', async () => {
            const generated = apiKeyService.generate();
            const createdKey = await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    apiKeyId: req.auth.currentApiKeyId()
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json().apiKeyId).toEqual(createdKey.id);
        });

        it('should update lastUsed tracking on successful auth', async () => {
            const generated = apiKeyService.generate();
            const createdKey = await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            // Verify lastUsedAt is initially null
            const keyBefore = await apiKeysRepo.getByIdForTenant(createdKey.id, tenant.id);
            expect(keyBefore.lastUsedAt).toBeNull();

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);

            // Verify lastUsedAt is now set
            const keyAfter = await apiKeysRepo.getByIdForTenant(createdKey.id, tenant.id);
            expect(keyAfter.lastUsedAt).not.toBeNull();
            expect(keyAfter.lastUsedIp).toBe('127.0.0.1');
        });

        it('should debounce lastUsed updates — skip DB write within 1 second', async () => {
            const generated = apiKeyService.generate();
            const createdKey = await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => reply.send({ success: true }));

            // First request — should write lastUsedAt
            await app.inject({ method: 'GET', url: '/test', headers: { [API_KEY_HEADER]: generated.fullKey } });
            const afterFirst = await apiKeysRepo.getByIdForTenant(createdKey.id, tenant.id);
            expect(afterFirst.lastUsedAt).not.toBeNull();
            const firstTimestamp = afterFirst.lastUsedAt!.getTime();

            // Second request immediately after — should be debounced (no DB write)
            await app.inject({ method: 'GET', url: '/test', headers: { [API_KEY_HEADER]: generated.fullKey } });
            const afterSecond = await apiKeysRepo.getByIdForTenant(createdKey.id, tenant.id);
            expect(afterSecond.lastUsedAt!.getTime()).toEqual(firstTimestamp);
        });

        it('should write lastUsed again after debounce interval expires', async () => {
            const generated = apiKeyService.generate();
            const createdKey = await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => reply.send({ success: true }));

            // First request — writes lastUsedAt
            await app.inject({ method: 'GET', url: '/test', headers: { [API_KEY_HEADER]: generated.fullKey } });
            const afterFirst = await apiKeysRepo.getByIdForTenant(createdKey.id, tenant.id);
            const firstTimestamp = afterFirst.lastUsedAt!.getTime();

            // Backdate the cache entry to simulate the debounce interval having elapsed
            // biome-ignore lint/complexity/useLiteralKeys: accessing private field for test
            validator['lastUsedCache'].set(createdKey.id, Date.now() - 2000);

            // Third request after cache expiry — should write again
            await app.inject({ method: 'GET', url: '/test', headers: { [API_KEY_HEADER]: generated.fullKey } });
            const afterThird = await apiKeysRepo.getByIdForTenant(createdKey.id, tenant.id);
            expect(afterThird.lastUsedAt!.getTime()).toBeGreaterThan(firstTimestamp);
        });

        it('should not create auth failure audit logs for successful authentication', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);

            const invalidKeyLogs = await auditLogsRepo.findPaginated(
                { actionType: 'api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            const tenantInvalidKeyLogs = await auditLogsRepo.findPaginated(
                { actionType: 'tenant.api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            const ipBlockedLogs = await auditLogsRepo.findPaginated(
                { actionType: 'tenant.api-key.auth-failure.ip-blocked' },
                { limit: 10, offset: 0 }
            );

            expect(invalidKeyLogs.items.length).toBe(0);
            expect(tenantInvalidKeyLogs.items.length).toBe(0);
            expect(ipBlockedLogs.items.length).toBe(0);
        });
    });

    describe('direct auth extraction methods', () => {
        it('should authenticate a tenant request through extractTenantAuthData()', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Tenant Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Tenant IP'
            });

            const app = Fastify();
            app.get('/test', async (req, reply) => {
                const auth = await validator.extractTenantAuthData(req);
                return reply.send({
                    tenantId: auth.currentTenant().id,
                    type: auth.type,
                    authMethod: auth.authMethod
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json()).toEqual({
                tenantId: tenant.id,
                type: TargetTypes.enum.tenant,
                authMethod: 'api_key'
            });
        });

        it('should authenticate an m2m app request through extractM2mAppAuthData()', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                m2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                m2mAppId,
                ipAddress: '127.0.0.1',
                description: 'M2M IP'
            });

            const app = Fastify();
            app.get('/test', async (req, reply) => {
                const auth = await validator.extractM2mAppAuthData(req);
                return reply.send({
                    m2mAppId: auth.currentM2mApp().id,
                    type: auth.type,
                    authMethod: auth.authMethod
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json()).toEqual({
                m2mAppId,
                type: 'm2m_app',
                authMethod: 'api_key'
            });
        });
    });

    describe('buildSyncHook', () => {
        it('should work as a synchronous hook wrapper', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '127.0.0.1',
                description: 'Test IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildSyncHook('tenant'));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    tenantId: req.auth.currentTenant().id,
                    authMethod: req.auth.authMethod
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.tenantId).toEqual(tenant.id);
            expect(body.authMethod).toBe('api_key');
        });

        it('should work as a synchronous hook wrapper for m2m_app', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                m2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                m2mAppId,
                ipAddress: '127.0.0.1',
                description: 'M2M IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildSyncHook('m2m_app'));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    m2mAppId: req.auth.currentM2mApp().id,
                    authMethod: req.auth.authMethod
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json()).toEqual({
                m2mAppId,
                authMethod: 'api_key'
            });
        });

        it('should propagate errors through the sync hook', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildSyncHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: 'invalid'
                }
            });

            expect(response.statusCode).toEqual(401);
        });
    });

    describe('audit logging', () => {
        it('should create audit log for missing API key', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {}
            });

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'missing_header',
                requestPath: '/test',
                requestMethod: 'GET'
            });
        });

        it('should create audit log for invalid key format', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: 'invalid-format'
                }
            });

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'invalid_format',
                requestPath: '/test',
                requestMethod: 'GET'
            });
        });

        it('should create audit log for key not found', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const validFormatKey = `priv_sk_${'a'.repeat(64)}`;

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: validFormatKey
                }
            });

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'not_found_or_inactive',
                keyPrefix: 'priv_sk_aaaa',
                requestPath: '/test',
                requestMethod: 'GET'
            });
        });

        it('should use the target-neutral action for a key not found on an m2m_app route', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('m2m_app'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const validFormatKey = `priv_sk_${'a'.repeat(64)}`;

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: validFormatKey
                }
            });

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'not_found_or_inactive',
                keyPrefix: 'priv_sk_aaaa'
            });
        });

        it('should not attribute a key not found to the first allowed target', async () => {
            const app = Fastify();
            app.addHook('preHandler', async (req) => {
                req.auth = await validator.extractAuthDataForTargets(req, ['tenant', 'm2m_app']);
            });
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const validFormatKey = `priv_sk_${'a'.repeat(64)}`;

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: validFormatKey
                }
            });

            const tenantLogs = await auditLogsRepo.findPaginated(
                { actionType: 'tenant.api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            expect(tenantLogs.items.length).toBe(0);

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'api-key.auth-failure.invalid-key' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'not_found_or_inactive',
                keyPrefix: 'priv_sk_aaaa'
            });
        });

        it('should create audit log for IP blocked with tenantId', async () => {
            // Create a valid API key
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                tenantId: tenant.id,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            // Add a different IP to whitelist
            await ipWhitelistRepo.create({
                tenantId: tenant.id,
                ipAddress: '10.0.0.1',
                description: 'Different IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('tenant'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'tenant.api-key.auth-failure.ip-blocked' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.activeTenantId).toBe(tenant.id);
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'ip_not_whitelisted',
                keyPrefix: generated.keyPrefix,
                requestPath: '/test',
                requestMethod: 'GET'
            });
        });

        it('should create audit log for m2m app IP blocked with m2mAppId', async () => {
            const generated = apiKeyService.generate();
            await apiKeysRepo.create({
                m2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: new Date(Date.now() + 86400000)
            });

            await ipWhitelistRepo.create({
                m2mAppId,
                ipAddress: '10.0.0.1',
                description: 'Different IP'
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook('m2m_app'));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    [API_KEY_HEADER]: generated.fullKey
                }
            });

            const logs = await auditLogsRepo.findPaginated(
                { actionType: 'm2m-app.api-key.auth-failure.ip-blocked' },
                { limit: 10, offset: 0 }
            );
            expect(logs.items.length).toBe(1);
            expect(logs.items[0]!.activeTenantId).toBeNull();
            expect(logs.items[0]!.actionDetails).toMatchObject({
                resourceType: 'api-key',
                reason: 'ip_not_whitelisted',
                keyPrefix: generated.keyPrefix,
                requestPath: '/test',
                requestMethod: 'GET',
                m2mAppId
            });
        });
    });
});
