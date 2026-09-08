import type { Address } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { m2mApplicationsTable } from '../db/schema';
import { ApiKeyService } from '../services/api-key-service';
import { EntityNotFound } from '../utils/error-types';
import { ApiKeysRepository } from './api-keys-repository';
import { TenantsRepository } from './tenants-repository';

describe('TenantApiKeysRepository', () => {
    let repository: ApiKeysRepository;
    let tenantsRepository: TenantsRepository;
    let apiKeyService: ApiKeyService;
    let testTenantId: string;
    let testM2mAppId: string;

    const testPublicKey = '0x1234567890123456789012345678901234567890' as Address;

    beforeEach<Fixture>(async ({ db }) => {
        tenantsRepository = new TenantsRepository(db);
        repository = new ApiKeysRepository(db);
        apiKeyService = new ApiKeyService();

        // Create a test tenant
        const tenant = await tenantsRepository.create({
            name: 'Test Tenant',
            publicKey: testPublicKey,
            defaultRoles: []
        });
        testTenantId = tenant.id;

        testM2mAppId = 'm2m-app-1';
        await db.insert(m2mApplicationsTable).values({
            id: testM2mAppId,
            name: 'Test M2M App'
        });
    });

    describe('create', () => {
        it('should create an API key with expiration', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const result = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            expect(result.id).toBeDefined();
            expect(result.name).toBe('Test Key');
            expect(result.keyHash).toBe(generated.keyHash);
            expect(result.keyPrefix).toBe(generated.keyPrefix);
            expect(result.tenantId).toBe(testTenantId);
            expect(result.revokedAt).toBeNull();
            expect(result.expiresAt).toEqual(expiresAt);
        });

        it('should throw for non-existent tenant (FK constraint)', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await expect(
                repository.create({
                    tenantId: 'non-existent-tenant',
                    name: 'Test Key',
                    keyHash: generated.keyHash,
                    keyPrefix: generated.keyPrefix,
                    expiresAt
                })
            ).rejects.toThrow();
        });

        it('should reject duplicate key hashes', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tenantId: testTenantId,
                name: 'First Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await expect(
                repository.create({
                    tenantId: testTenantId,
                    name: 'Duplicate Key',
                    keyHash: generated.keyHash,
                    keyPrefix: generated.keyPrefix,
                    expiresAt
                })
            ).rejects.toThrow();
        });

        it('should create an API key for an m2m app', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const result = await repository.create({
                m2mAppId: testM2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            expect(result.m2mAppId).toBe(testM2mAppId);
            expect(result.tenantId).toBeNull();
        });
    });

    describe('findActiveByKeyHash', () => {
        it('should find an active key by hash', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            const found = await repository.findActiveByKeyHash(generated.keyHash);

            expect(found).toBeDefined();
            expect(found?.keyHash).toBe(generated.keyHash);
            expect(found?.name).toBe('Test Key');
        });

        it('should not find a revoked key', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.revoke(created.id, testTenantId);

            const found = await repository.findActiveByKeyHash(generated.keyHash);
            expect(found).toBeUndefined();
        });

        it('should not find an expired key', async () => {
            const generated = apiKeyService.generate();
            const pastDate = new Date(Date.now() - 1000); // Already expired

            await repository.create({
                tenantId: testTenantId,
                name: 'Expired Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: pastDate
            });

            const found = await repository.findActiveByKeyHash(generated.keyHash);
            expect(found).toBeUndefined();
        });

        it('should find a key that expires in the future', async () => {
            const generated = apiKeyService.generate();
            const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tenantId: testTenantId,
                name: 'Future Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt: futureDate
            });

            const found = await repository.findActiveByKeyHash(generated.keyHash);
            expect(found).toBeDefined();
        });

        it('should return undefined for non-existent hash', async () => {
            const found = await repository.findActiveByKeyHash('nonexistent');
            expect(found).toBeUndefined();
        });
    });

    describe('findByTenantId', () => {
        it('should return all keys for a tenant', async () => {
            const key1 = apiKeyService.generate();
            const key2 = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tenantId: testTenantId,
                name: 'Key 1',
                keyHash: key1.keyHash,
                keyPrefix: key1.keyPrefix,
                expiresAt
            });

            await repository.create({
                tenantId: testTenantId,
                name: 'Key 2',
                keyHash: key2.keyHash,
                keyPrefix: key2.keyPrefix,
                expiresAt
            });

            const result = await repository.findByTenantId(testTenantId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination.totalItems).toBe(2);
        });

        it('should include revoked keys in the list', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.revoke(created.id, testTenantId);

            const result = await repository.findByTenantId(testTenantId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.revokedAt).not.toBeNull();
        });

        it('should paginate results', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            // Create 5 keys
            for (let i = 0; i < 5; i++) {
                const generated = apiKeyService.generate();
                await repository.create({
                    tenantId: testTenantId,
                    name: `Key ${i}`,
                    keyHash: generated.keyHash,
                    keyPrefix: generated.keyPrefix,
                    expiresAt
                });
            }

            const page1 = await repository.findByTenantId(testTenantId, { limit: 2, offset: 0 });
            const page2 = await repository.findByTenantId(testTenantId, { limit: 2, offset: 2 });

            expect(page1.items).toHaveLength(2);
            expect(page2.items).toHaveLength(2);
            expect(page1.pagination.totalItems).toBe(5);
            expect(page1.pagination.totalPages).toBe(3);
        });

        it('should return empty for tenant with no keys', async () => {
            const result = await repository.findByTenantId(testTenantId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });
    });

    describe('getByIdForTenant', () => {
        it('should find a key by ID', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            const found = await repository.getByIdForTenant(created.id, testTenantId);

            expect(found.id).toBe(created.id);
            expect(found.name).toBe('Test Key');
        });

        it('should throw EntityNotFound for non-existent ID', async () => {
            await expect(repository.getByIdForTenant('non-existent', testTenantId)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound if key belongs to different tenant', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await expect(repository.getByIdForTenant(created.id, 'different-tenant')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('revoke', () => {
        it('should revoke a key', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.revoke(created.id, testTenantId);

            const found = await repository.getByIdForTenant(created.id, testTenantId);
            expect(found.revokedAt).not.toBeNull();
        });

        it('should be idempotent (revoking twice should not throw)', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.revoke(created.id, testTenantId);
            await repository.revoke(created.id, testTenantId);

            const found = await repository.getByIdForTenant(created.id, testTenantId);
            expect(found.revokedAt).not.toBeNull();
        });

        it('should throw EntityNotFound for non-existent key', async () => {
            await expect(repository.revoke('non-existent', testTenantId)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound if key belongs to different tenant', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await expect(repository.revoke(created.id, 'different-tenant')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('findByM2mAppId', () => {
        it('should return all keys for an m2m app', async () => {
            const key1 = apiKeyService.generate();
            const key2 = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                m2mAppId: testM2mAppId,
                name: 'Key 1',
                keyHash: key1.keyHash,
                keyPrefix: key1.keyPrefix,
                expiresAt
            });

            await repository.create({
                m2mAppId: testM2mAppId,
                name: 'Key 2',
                keyHash: key2.keyHash,
                keyPrefix: key2.keyPrefix,
                expiresAt
            });

            const result = await repository.findByM2mAppId(testM2mAppId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination.totalItems).toBe(2);
        });

        it('should not return keys belonging to a tenant', async () => {
            const tenantKey = apiKeyService.generate();
            const m2mKey = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tenantId: testTenantId,
                name: 'Tenant Key',
                keyHash: tenantKey.keyHash,
                keyPrefix: tenantKey.keyPrefix,
                expiresAt
            });

            await repository.create({
                m2mAppId: testM2mAppId,
                name: 'M2M Key',
                keyHash: m2mKey.keyHash,
                keyPrefix: m2mKey.keyPrefix,
                expiresAt
            });

            const result = await repository.findByM2mAppId(testM2mAppId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe('M2M Key');
        });

        it('should return empty for m2m app with no keys', async () => {
            const result = await repository.findByM2mAppId(testM2mAppId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });
    });

    describe('revokeForM2mApp', () => {
        it('should revoke a key scoped to m2m app', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                m2mAppId: testM2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.revokeForM2mApp(created.id, testM2mAppId);

            const result = await repository.findByM2mAppId(testM2mAppId, { limit: 10, offset: 0 });
            expect(result.items[0]?.revokedAt).not.toBeNull();
        });

        it('should be idempotent (revoking twice should not throw)', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                m2mAppId: testM2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.revokeForM2mApp(created.id, testM2mAppId);
            await repository.revokeForM2mApp(created.id, testM2mAppId);

            const result = await repository.findByM2mAppId(testM2mAppId, { limit: 10, offset: 0 });
            expect(result.items[0]?.revokedAt).not.toBeNull();
        });

        it('should throw EntityNotFound for non-existent key', async () => {
            await expect(repository.revokeForM2mApp('non-existent', testM2mAppId)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound if key belongs to different m2m app', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                m2mAppId: testM2mAppId,
                name: 'M2M Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await expect(repository.revokeForM2mApp(created.id, 'different-m2m-app')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('updateLastUsed', () => {
        it('should update last used timestamp and IP', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            expect(created.lastUsedAt).toBeNull();
            expect(created.lastUsedIp).toBeNull();

            const beforeUpdate = new Date();
            await repository.updateLastUsed(created.id, '192.168.1.1');

            const found = await repository.getByIdForTenant(created.id, testTenantId);
            expect(found.lastUsedAt).not.toBeNull();
            expect(found.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
            expect(found.lastUsedIp).toBe('192.168.1.1');
        });

        it('should update with null IP', async () => {
            const generated = apiKeyService.generate();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const created = await repository.create({
                tenantId: testTenantId,
                name: 'Test Key',
                keyHash: generated.keyHash,
                keyPrefix: generated.keyPrefix,
                expiresAt
            });

            await repository.updateLastUsed(created.id, null);

            const found = await repository.getByIdForTenant(created.id, testTenantId);
            expect(found.lastUsedAt).not.toBeNull();
            expect(found.lastUsedIp).toBeNull();
        });
    });
});
