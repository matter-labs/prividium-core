import { pad, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { UserSources } from '../db/schema';
import { EntityNotFound } from '../utils/error-types';
import { RolesRepository } from './roles-repository';
import { type Tenant, TenantsRepository } from './tenants-repository';
import { UsersRepository } from './users-repository';

describe('TenantsRepository', () => {
    let repository: TenantsRepository;
    let rolesRepo: RolesRepository;
    let userRepo: UsersRepository;

    const privateKey = generatePrivateKey();
    const address = privateKeyToAddress(privateKey);

    beforeEach<Fixture>(async ({ db }) => {
        rolesRepo = new RolesRepository(db);
        userRepo = new UsersRepository(db);
        repository = new TenantsRepository(db);
    });

    describe('create', () => {
        it('creates a basic tenant', async () => {
            const name = 'tenant01';

            const tenant = await repository.create({
                name: name,
                publicKey: address,
                defaultRoles: []
            });

            expect(tenant.id).toHaveLength(21); // default nonoid length
            expect(tenant.name).toEqual(name);
            expect(tenant.publicKey).toEqual(address);
            expect(tenant.createdAt).toBeInstanceOf(Date);
            expect(tenant.updatedAt).toBeInstanceOf(Date);
        });

        it('can create associate roles', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const role2 = await rolesRepo.create({ roleName: 'role02', systemPermissions: [] });

            const tenant = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [role1, role2]
            });

            expect(tenant.defaultRoles.map((r) => r.roleName)).toContain(role1.roleName);
            expect(tenant.defaultRoles.map((r) => r.roleName)).toContain(role2.roleName);
            expect(tenant.defaultRoles).toHaveLength(2);
        });

        it('can create associated roles sending only roleName', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });

            const tenant = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [{ id: role1.id }]
            });

            expect(tenant.defaultRoles.map((r) => r.roleName)).toContain(role1.roleName);
            expect(tenant.defaultRoles).toHaveLength(1);
        });

        it('throws if try to associate a role that does not exist', async () => {
            await expect(
                repository.create({
                    name: 'tenant01',
                    publicKey: address,
                    defaultRoles: [{ id: 'doesnotexist' }]
                })
            ).rejects.toThrow(EntityNotFound);

            const { items } = await repository.searchPaginated({ limit: 10, offset: 0 });
            expect(items).toHaveLength(0);
        });
    });

    describe('getById', () => {
        it('throws when id does not exists', async () => {
            await expect(repository.getById('doesnotexists')).rejects.toThrow(EntityNotFound);
        });

        it('returns all the data when id exists', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const created = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [{ id: role1.id }]
            });

            const retrieved = await repository.getById(created.id);
            expect(retrieved.id).toEqual(created.id);
            expect(retrieved.name).toEqual(created.name);
            expect(retrieved.publicKey).toEqual(address);
            expect(retrieved.createdAt).toEqual(created.createdAt);
            expect(retrieved.updatedAt).toEqual(created.createdAt);
        });
    });

    describe('searchPaginated', () => {
        it('returns empty list when no tenants created', async () => {
            expect(await repository.searchPaginated({ limit: 10, offset: 0 })).toEqual({
                items: [],
                pagination: {
                    currentPage: 1,
                    limit: 10,
                    offset: 0,
                    totalItems: 0,
                    totalPages: 0
                }
            });
        });

        it('returns all data for existing tenants', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const tenant1 = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [{ id: role1.id }]
            });

            const tenant2 = await repository.create({
                name: 'tenant02',
                publicKey: privateKeyToAddress(generatePrivateKey()),
                defaultRoles: [{ id: role1.id }]
            });

            const res = await repository.searchPaginated({ limit: 10, offset: 0 });
            expect(res.pagination).toEqual({
                currentPage: 1,
                limit: 10,
                offset: 0,
                totalItems: 2,
                totalPages: 1
            });
            expect(res.items).toContainEqual(tenant1);
            expect(res.items).toContainEqual(tenant2);
            expect(res.items).toHaveLength(2);
        });

        it('returns results ordered by creation date', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });

            for (let i = 0; i < 11; i++) {
                await repository.create({
                    name: `tenant-${i}`,
                    publicKey: pad(toHex(i), { size: 20 }),
                    defaultRoles: [{ id: role1.id }]
                });
            }

            const res = await repository.searchPaginated({ limit: 10, offset: 0 });
            expect(res.pagination).toEqual({
                currentPage: 1,
                limit: 10,
                offset: 0,
                totalItems: 11,
                totalPages: 2
            });
            expect(res.items).toHaveLength(10);
            expect(res.items.map((i) => i.name)).toEqual([
                'tenant-0',
                'tenant-1',
                'tenant-2',
                'tenant-3',
                'tenant-4',
                'tenant-5',
                'tenant-6',
                'tenant-7',
                'tenant-8',
                'tenant-9'
            ]);

            vi.useRealTimers();
        });
    });

    describe('update', () => {
        it('updates an existing fields', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const created = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [{ id: role1.id }]
            });

            const newAddress = privateKeyToAddress(generatePrivateKey());

            const updated = await repository.update(created.id, {
                ...created,
                name: 'newTenant',
                publicKey: newAddress
            });

            expect(updated.name).toEqual('newTenant');
            expect(updated.publicKey).toEqual(newAddress);

            const retrieved = await repository.getById(created.id);
            expect(retrieved.name).toEqual('newTenant');
            expect(retrieved.publicKey).toEqual(newAddress);
        });

        it('adds new default roles', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const created = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [{ id: role1.id }]
            });

            const role2 = await rolesRepo.create({ roleName: 'role02', systemPermissions: [] });

            const updated = await repository.update(created.id, {
                ...created,
                defaultRoles: [role1, role2]
            });
            expectRoles(updated.defaultRoles, [role1.roleName, role2.roleName]);

            const retrieved = await repository.getById(created.id);
            expectRoles(retrieved.defaultRoles, [role1.roleName, role2.roleName]);
        });

        it('removes default roles', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const role2 = await rolesRepo.create({ roleName: 'role02', systemPermissions: [] });

            const created = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: [role1, role2]
            });

            const updated = await repository.update(created.id, {
                ...created,
                defaultRoles: [role1]
            });
            expectRoles(updated.defaultRoles, [role1.roleName]);

            const retrieved = await repository.getById(created.id);
            expectRoles(retrieved.defaultRoles, [role1.roleName]);
        });

        it('throws if try to associate a role that does not exist', async () => {
            const created = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: []
            });

            await expect(
                repository.update(created.id, {
                    ...created,
                    defaultRoles: [{ id: 'doesnotexist' }]
                })
            ).rejects.toThrow(EntityNotFound);

            const retrieved = await repository.getById(created.id);
            expect(retrieved).toEqual(created);
        });
    });

    describe('delete', () => {
        it('can delete an existing tenant', async () => {
            const created = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: []
            });

            await repository.delete(created.id);

            await expect(repository.getById(created.id)).rejects.toThrow(EntityNotFound);
        });

        it('throws if tenant does not exist', async () => {
            await expect(repository.delete('doesnotexist')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('createUser', () => {
        let existingTenant: Tenant;
        beforeEach(async () => {
            existingTenant = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: []
            });
        });

        it('can add a new user user', async () => {
            const displayName = 'someName';
            const res = await repository.createUser(existingTenant.id, {
                displayName: displayName,
                walletAddresses: []
            });
            expect(res).toHaveProperty('id');
            expect(res.displayName).toEqual(displayName);
            expect(res.walletAddresses).toEqual([]);
        });

        it('can add a user with display name', async () => {
            const user = await repository.createUser(existingTenant.id, {
                displayName: 'Tenant User',
                walletAddresses: []
            });

            expect(user).toHaveProperty('id');
            expect(user.displayName).toBe('Tenant User');
            expect(user.walletAddresses).toEqual([]);
        });

        it('sets tenant as origin for the user', async () => {
            const user = await repository.createUser(existingTenant.id, {
                displayName: 'Tenant User',
                walletAddresses: []
            });

            const retrieved = await userRepo.findById(user.id);

            expect(retrieved?.source).toEqual(UserSources.enum.tenant);
        });

        it('throws if tenant does not exist', async () => {
            await expect(
                repository.createUser('does not exist', { displayName: 'Test User', walletAddresses: [] })
            ).rejects.toThrow(EntityNotFound);

            const tenantUserPaginatedResult = await repository.usersFor(existingTenant.id, { limit: 10, offset: 0 });
            expect(tenantUserPaginatedResult.items).toHaveLength(0);
        });

        it('new users are created with the default roles', async () => {
            const role1 = await rolesRepo.create({ roleName: 'role01', systemPermissions: [] });
            const role2 = await rolesRepo.create({ roleName: 'role02', systemPermissions: [] });

            await repository.update(existingTenant.id, {
                ...existingTenant,
                defaultRoles: [role1, role2]
            });

            await repository.update(existingTenant.id, {
                ...existingTenant,
                defaultRoles: [role1, role2]
            });

            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });
            const retrieved = await userRepo.findById(created.id);
            expect(retrieved?.roles).toHaveLength(2);
            expect(retrieved?.roles.map((r) => r.roleName)).toContain(role1.roleName);
            expect(retrieved?.roles.map((r) => r.roleName)).toContain(role2.roleName);
        });

        it('new users are created with the default roles', async () => {
            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: [{ walletAddress: address }]
            });
            const retrieved = await userRepo.findById(created.id);
            expect(retrieved?.wallets).toHaveLength(1);
            expect(retrieved?.wallets.map((w) => w.walletAddress)).toContain(address);
        });
    });

    describe('addWalletToUser', () => {
        let existingTenant: Tenant;
        beforeEach(async () => {
            existingTenant = await repository.create({
                name: 'tenant01',
                publicKey: address,
                defaultRoles: []
            });
        });

        it('adds the wallet to the user', async () => {
            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });
            await repository.addWalletsToUser(existingTenant.id, created.id, [{ walletAddress: address }]);

            const retrieved = await userRepo.findById(created.id);
            expect(retrieved?.wallets).toHaveLength(1);
            expect(retrieved?.wallets.map((w) => w.walletAddress)).toContain(address);
        });

        it('returns updated user', async () => {
            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });
            const updated = await repository.addWalletsToUser(existingTenant.id, created.id, [
                { walletAddress: address }
            ]);

            expect(updated.walletAddresses).toHaveLength(1);
            expect(updated.walletAddresses.map((w) => w.walletAddress)).toContain(address);
        });

        it('throws if tenant does not exist', async () => {
            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });

            await expect(
                repository.addWalletsToUser('doesnotexist', created.id, [{ walletAddress: address }])
            ).rejects.toThrow(EntityNotFound);

            const retrieved = await userRepo.findById(created.id);
            expect(retrieved?.wallets).toHaveLength(0);
        });

        it('throws if tenant user is not associated with curent tenant', async () => {
            const created = await userRepo.create({ displayName: 'Test User', source: 'adminPanel' });

            await expect(
                repository.addWalletsToUser('doesnotexist', created.id, [{ walletAddress: address }])
            ).rejects.toThrow(EntityNotFound);

            const retrieved = await userRepo.findById(created.id);
            expect(retrieved?.wallets).toHaveLength(0);
        });

        it('if address was already added there are no changes', async () => {
            const address1 = address;
            const address2 = privateKeyToAddress(generatePrivateKey());
            const address3 = privateKeyToAddress(generatePrivateKey());
            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });
            await repository.addWalletsToUser(existingTenant.id, created.id, [
                { walletAddress: address1 },
                { walletAddress: address2 }
            ]);
            await repository.addWalletsToUser(existingTenant.id, created.id, [
                { walletAddress: address1 },
                { walletAddress: address2 },
                { walletAddress: address3 }
            ]);

            const retrieved = await userRepo.findById(created.id);
            expect(retrieved?.wallets).toHaveLength(3);
            const addresses = retrieved?.wallets.map((w) => w.walletAddress);
            expect(new Set(addresses)).toEqual(new Set([address1, address2, address3]));
        });
    });
});

// // Helper functions for testing
function expectRoles(received: Tenant['defaultRoles'], expectedRoles: string[]) {
    expect(received).toHaveLength(expectedRoles.length);
    const roleNames = received.map((r) => r.roleName) || [];
    expect(roleNames).toEqual(expect.arrayContaining(expectedRoles));
}
