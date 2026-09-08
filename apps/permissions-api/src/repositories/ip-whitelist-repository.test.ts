import type { Address } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { m2mApplicationsTable } from '../db/schema';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError } from '../utils/error-types';
import { IpWhitelistRepository } from './ip-whitelist-repository';
import { TenantsRepository } from './tenants-repository';

// CIDRs broader than the per-family minimum (/16 IPv4, /32 IPv6). The reject test (guard on,
// the default) and the accept test (allowAnyCidr) share this list so every range is covered in
// both states.
const BROAD_CIDRS = [
    '0.0.0.0/0', // all IPv4
    '0.0.0.0/1', // lower half of IPv4
    '128.0.0.0/1', // upper half of IPv4
    '10.0.0.0/15', // one bit broader than the /16 IPv4 minimum
    '::/0', // all IPv6
    '::0/0', // all IPv6, alternate spelling
    '0::/0', // all IPv6, alternate spelling
    '2000::/3', // IPv6 global-unicast block
    '2a00::/12', // a broad IPv6 block
    '2001:db8::/31' // one bit broader than the /32 IPv6 minimum
];

describe('TenantIpWhitelistRepository', () => {
    let repository: IpWhitelistRepository;
    let tenantsRepository: TenantsRepository;
    let testTenantId: string;
    let testM2mAppId: string;

    const testPublicKey = '0x1234567890123456789012345678901234567890' as Address;

    beforeEach<Fixture>(async ({ db }) => {
        tenantsRepository = new TenantsRepository(db);
        repository = new IpWhitelistRepository(db);

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
        it('should create an IP whitelist entry', async () => {
            const result = await repository.create({
                tenantId: testTenantId,
                ipAddress: '192.168.1.1',
                description: 'Office IP'
            });

            expect(result.id).toBeDefined();
            expect(result.ipAddress).toBe('192.168.1.1');
            expect(result.description).toBe('Office IP');
            expect(result.tenantId).toBe(testTenantId);
        });

        it('should create an IPv6 whitelist entry', async () => {
            const result = await repository.create({
                tenantId: testTenantId,
                ipAddress: '2001:db8::1'
            });

            expect(result.ipAddress).toBe('2001:db8::1');
        });

        it('should throw InvalidInputError for invalid IP', async () => {
            await expect(
                repository.create({
                    tenantId: testTenantId,
                    ipAddress: 'not-an-ip'
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('should throw for non-existent tenant (FK constraint)', async () => {
            await expect(
                repository.create({
                    tenantId: 'non-existent-tenant',
                    ipAddress: '192.168.1.1'
                })
            ).rejects.toThrow();
        });

        it('should throw EntityAlreadyExistsError on duplicate IP for same tenant', async () => {
            await repository.create({
                tenantId: testTenantId,
                ipAddress: '192.168.1.1'
            });

            await expect(
                repository.create({
                    tenantId: testTenantId,
                    ipAddress: '192.168.1.1'
                })
            ).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should throw EntityAlreadyExistsError on duplicate IP for same m2m app', async () => {
            await repository.create({
                m2mAppId: testM2mAppId,
                ipAddress: '192.168.1.1'
            });

            await expect(
                repository.create({
                    m2mAppId: testM2mAppId,
                    ipAddress: '192.168.1.1'
                })
            ).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should create a CIDR whitelist entry', async () => {
            const result = await repository.create({
                tenantId: testTenantId,
                ipAddress: '10.42.0.0/16',
                description: 'Pod network'
            });

            expect(result.ipAddress).toBe('10.42.0.0/16');
            expect(result.tenantId).toBe(testTenantId);
        });

        it('should create an IPv6 CIDR whitelist entry', async () => {
            const result = await repository.create({
                tenantId: testTenantId,
                ipAddress: '2001:db8::/32'
            });

            expect(result.ipAddress).toBe('2001:db8::/32');
        });

        it('should throw InvalidInputError for invalid CIDR', async () => {
            await expect(
                repository.create({
                    tenantId: testTenantId,
                    ipAddress: '10.42.0.0/99'
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('should throw InvalidInputError for malformed CIDR', async () => {
            await expect(
                repository.create({
                    tenantId: testTenantId,
                    ipAddress: 'garbage/16'
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('should throw InvalidInputError for CIDR with host bits set', async () => {
            await expect(
                repository.create({
                    tenantId: testTenantId,
                    ipAddress: '10.42.1.5/16'
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('should throw InvalidInputError for overbroad CIDR ranges', async () => {
            for (const ipAddress of BROAD_CIDRS) {
                await expect(
                    repository.create({
                        tenantId: testTenantId,
                        ipAddress
                    })
                ).rejects.toThrow(InvalidInputError);
            }
        });

        it('should accept the same overbroad CIDR ranges when allowAnyCidr is set', async () => {
            for (const ipAddress of BROAD_CIDRS) {
                const result = await repository.create({ m2mAppId: testM2mAppId, ipAddress }, { allowAnyCidr: true });
                expect(result.ipAddress).toBe(ipAddress);
            }
        });

        it('should still reject host-bit-set CIDRs even when allowAnyCidr is set', async () => {
            await expect(
                repository.create({ m2mAppId: testM2mAppId, ipAddress: '10.42.1.5/16' }, { allowAnyCidr: true })
            ).rejects.toThrow(InvalidInputError);
        });

        it('should create an IP whitelist entry for an m2m app', async () => {
            const result = await repository.create({
                m2mAppId: testM2mAppId,
                ipAddress: '192.168.1.2',
                description: 'M2M Office IP'
            });

            expect(result.m2mAppId).toBe(testM2mAppId);
            expect(result.tenantId).toBeNull();
        });
    });

    describe('findByTenantId', () => {
        it('should return all IP entries for a tenant', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });
            await repository.create({ tenantId: testTenantId, ipAddress: '10.0.0.1' });

            const result = await repository.findByTenantId(testTenantId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination.totalItems).toBe(2);
        });

        it('should paginate results', async () => {
            for (let i = 0; i < 5; i++) {
                await repository.create({ tenantId: testTenantId, ipAddress: `192.168.1.${i}` });
            }

            const page1 = await repository.findByTenantId(testTenantId, { limit: 2, offset: 0 });
            const page2 = await repository.findByTenantId(testTenantId, { limit: 2, offset: 2 });

            expect(page1.items).toHaveLength(2);
            expect(page2.items).toHaveLength(2);
            expect(page1.pagination.totalItems).toBe(5);
        });

        it('should return empty for tenant with no entries', async () => {
            const result = await repository.findByTenantId(testTenantId, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });
    });

    describe('getAllForTenant', () => {
        it('should return all IPs as strings', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });
            await repository.create({ tenantId: testTenantId, ipAddress: '10.0.0.1' });

            const ips = await repository.getAllForTenant(testTenantId);

            expect(ips).toHaveLength(2);
            expect(ips).toContain('192.168.1.1');
            expect(ips).toContain('10.0.0.1');
        });

        it('should return empty array for no entries', async () => {
            const ips = await repository.getAllForTenant(testTenantId);
            expect(ips).toHaveLength(0);
        });
    });

    describe('getByIdForTenant', () => {
        it('should find an entry by ID', async () => {
            const created = await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });

            const found = await repository.getByIdForTenant(created.id, testTenantId);

            expect(found.id).toBe(created.id);
            expect(found.ipAddress).toBe('192.168.1.1');
        });

        it('should throw EntityNotFound for non-existent ID', async () => {
            await expect(repository.getByIdForTenant('non-existent', testTenantId)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound if entry belongs to different tenant', async () => {
            const created = await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });

            await expect(repository.getByIdForTenant(created.id, 'different-tenant')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('delete', () => {
        it('should delete an entry', async () => {
            const created = await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });

            await repository.deleteForTenant(created.id, testTenantId);

            await expect(repository.getByIdForTenant(created.id, testTenantId)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound for non-existent entry', async () => {
            await expect(repository.deleteForTenant('non-existent', testTenantId)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound if entry belongs to different tenant', async () => {
            const created = await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });

            await expect(repository.deleteForTenant(created.id, 'different-tenant')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('isIpAllowed', () => {
        it('should disallow all IPs when whitelist is empty', async () => {
            expect(await repository.isTenantIpAllowed(testTenantId, '1.2.3.4')).toBe(false);
            expect(await repository.isTenantIpAllowed(testTenantId, '192.168.1.1')).toBe(false);
        });

        it('should allow exact IP match', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });

            expect(await repository.isTenantIpAllowed(testTenantId, '192.168.1.1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '192.168.1.2')).toBe(false);
        });

        it('should check multiple whitelist entries', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });
            await repository.create({ tenantId: testTenantId, ipAddress: '10.0.0.1' });

            expect(await repository.isTenantIpAllowed(testTenantId, '192.168.1.1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '10.0.0.1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '172.16.0.1')).toBe(false);
        });

        it('should handle IPv6 addresses', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '2001:db8::1' });

            expect(await repository.isTenantIpAllowed(testTenantId, '2001:db8::1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '2001:db9::1')).toBe(false);
        });

        it('should allow IP within a CIDR range', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '10.42.0.0/16' });

            expect(await repository.isTenantIpAllowed(testTenantId, '10.42.1.5')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '10.42.255.255')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '10.43.0.1')).toBe(false);
        });

        it('should allow IP within an IPv6 CIDR range', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '2001:db8::/32' });

            expect(await repository.isTenantIpAllowed(testTenantId, '2001:db8::1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '2001:db8:1::1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '2001:db9::1')).toBe(false);
        });

        it('should match exact IPs and CIDRs together', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });
            await repository.create({ tenantId: testTenantId, ipAddress: '10.42.0.0/16' });

            expect(await repository.isTenantIpAllowed(testTenantId, '192.168.1.1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '10.42.5.10')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '192.168.1.2')).toBe(false);
        });

        it('should work with CIDR for m2m apps', async () => {
            await repository.create({ m2mAppId: testM2mAppId, ipAddress: '10.42.0.0/16' });

            expect(await repository.isM2mAppIpAllowed(testM2mAppId, '10.42.1.1')).toBe(true);
            expect(await repository.isM2mAppIpAllowed(testM2mAppId, '10.43.0.1')).toBe(false);
        });

        it('should allow any client when allow-all CIDRs are whitelisted', async () => {
            await repository.create({ m2mAppId: testM2mAppId, ipAddress: '0.0.0.0/0' }, { allowAnyCidr: true });
            await repository.create({ m2mAppId: testM2mAppId, ipAddress: '::/0' }, { allowAnyCidr: true });

            // 0.0.0.0/0 matches every IPv4 client (public, private, loopback)...
            for (const ipv4 of ['203.0.113.7', '10.0.0.1', '127.0.0.1']) {
                expect(await repository.isM2mAppIpAllowed(testM2mAppId, ipv4)).toBe(true);
            }
            // ...and ::/0 matches every IPv6 client (global, loopback, link-local).
            for (const ipv6 of ['2001:db8::1', '::1', 'fe80::1']) {
                expect(await repository.isM2mAppIpAllowed(testM2mAppId, ipv6)).toBe(true);
            }
        });

        it('should match /32 CIDR as a single host', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '10.0.0.5/32' });

            expect(await repository.isTenantIpAllowed(testTenantId, '10.0.0.5')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '10.0.0.4')).toBe(false);
            expect(await repository.isTenantIpAllowed(testTenantId, '10.0.0.6')).toBe(false);
        });

        it('should return false for unparseable client IP', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '10.42.0.0/16' });

            expect(await repository.isTenantIpAllowed(testTenantId, 'not-an-ip')).toBe(false);
        });

        it('should match IPv4-mapped IPv6 client against IPv4 whitelist', async () => {
            await repository.create({ tenantId: testTenantId, ipAddress: '192.168.1.1' });
            await repository.create({ tenantId: testTenantId, ipAddress: '10.42.0.0/16' });

            expect(await repository.isTenantIpAllowed(testTenantId, '::ffff:192.168.1.1')).toBe(true);
            expect(await repository.isTenantIpAllowed(testTenantId, '::ffff:10.42.1.5')).toBe(true);
        });
    });
});
