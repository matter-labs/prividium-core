import { ADMIN_ROLE_ID } from '@repo/access-control';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { rolesTable, UserSources } from '../db/schema';
import { SystemPermissions } from '../permissions/system-permissions';
import { EntityAlreadyExistsError, EntityNotFound, InvalidEntity } from '../utils/error-types';
import { ContractFunctionPermissionsRepository } from './contract-function-permissions-repository';
import { ContractsRepository } from './contracts-repository';
import { type InsertRole, RolesRepository } from './roles-repository';
import { UsersRepository } from './users-repository';

describe('RolesRepository', () => {
    let repository: RolesRepository;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new RolesRepository(db);
    });

    describe('create', () => {
        it('should create a new role', async () => {
            const newRole: InsertRole = { roleName: 'someRole', systemPermissions: ['full_sequencer_rpc_access'] };

            const result = await repository.create(newRole);

            expect(result.roleName).toBe('someRole');
            expect(result.isSystemRole).toBe(false);
            expect(result.systemPermissions).toEqual(['full_sequencer_rpc_access']);
            expect(result.createdAt).toBeDefined();
            expect(result.updatedAt).toBeDefined();
        });

        it('should throw if role already exists', async () => {
            const role: InsertRole = { roleName: 'existing', systemPermissions: [] };
            await repository.create(role);

            await expect(repository.create(role)).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should create roles with different names', async () => {
            const role1 = await repository.create({ roleName: 'role1', systemPermissions: [] });
            const role2 = await repository.create({ roleName: 'role2', systemPermissions: [] });

            expect(role1.roleName).toBe('role1');
            expect(role2.roleName).toBe('role2');
        });

        it('cannot create a role named "admin"', async () => {
            await expect(repository.create({ roleName: 'admin', systemPermissions: [] })).rejects.toThrow(
                InvalidEntity
            );

            await expect(repository.findScoped(ADMIN_ROLE_ID)).resolves.toBeUndefined();
        });
    });

    describe('findScoped', () => {
        it('should find role by id', async () => {
            const created = await repository.create({ roleName: 'watcher', systemPermissions: [] });

            const found = await repository.findScoped(created.id);

            expect(found).toBeDefined();
            expect(found?.roleName).toBe('watcher');
            expect(found?.createdAt).toEqual(created.createdAt);
        });

        it('should return undefined if role not found', async () => {
            const result = await repository.findScoped('nonexistent');
            expect(result).toBeUndefined();
        });
    });

    describe('update', () => {
        it('should throw EntityNotFound if updating non-existent role with values', async () => {
            await expect(
                repository.updateById('nonexistent', {
                    roleName: 'nonexistent',
                    systemPermissions: []
                })
            ).rejects.toThrow(EntityNotFound);
        });
    });

    describe('delete', () => {
        it('should delete a role', async () => {
            const someRole = await repository.create({ roleName: 'someRole', systemPermissions: [] });

            await repository.deleteById(someRole.id);

            const found = await repository.findScoped(someRole.id);
            expect(found).toBeUndefined();
        });

        it('should throw EntityNotFound if role not found', async () => {
            await expect(repository.deleteById('nonexistent')).rejects.toThrow(EntityNotFound);
        });

        it('cannot remove admin role', async () => {
            const admin = await repository.createOrUpdateAdminRole();
            await expect(repository.deleteById(admin.id)).rejects.toThrow(InvalidEntity);
            await expect(repository.findScoped(admin.id)).resolves.not.toBeUndefined();
        });

        it('cannot remove system roles', async ({ db }) => {
            const [role] = await db
                .insert(rolesTable)
                .values({
                    roleName: 'system-role-01',
                    isSystemRole: true,
                    systemPermissions: []
                })
                .returning();

            if (role === undefined || role.id === undefined) {
                expect.fail('Role should have been created.');
            }

            await expect(repository.deleteById(role.id)).rejects.toThrow(InvalidEntity);

            await expect(repository.findScoped(role.id)).resolves.not.toBeUndefined();
        });
    });

    describe('findPaginated', () => {
        it('should return paginated results', async () => {
            // Create multiple roles
            await repository.create({ roleName: 'role1', systemPermissions: [] });
            await repository.create({ roleName: 'role2', systemPermissions: [] });
            await repository.create({ roleName: 'role3', systemPermissions: [] });
            await repository.create({ roleName: 'role4', systemPermissions: [] });
            await repository.create({ roleName: 'role5', systemPermissions: [] });

            const result = await repository.findPaginated({ limit: 2, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination).toEqual({
                currentPage: 1,
                totalPages: 3,
                totalItems: 5,
                limit: 2,
                offset: 0
            });
        });

        it('should handle different pages', async () => {
            await repository.create({ roleName: 'role1', systemPermissions: [] });
            await repository.create({ roleName: 'role2', systemPermissions: [] });
            await repository.create({ roleName: 'role3', systemPermissions: [] });

            const page1 = await repository.findPaginated({ limit: 2, offset: 0 });
            const page2 = await repository.findPaginated({ limit: 2, offset: 2 });

            expect(page1.items).toHaveLength(2);
            expect(page2.items).toHaveLength(1);
            expect(page1.pagination.currentPage).toBe(1);
            expect(page2.pagination.currentPage).toBe(2);
        });

        it('should return empty results for out of range offset', async () => {
            await repository.create({ roleName: 'role1', systemPermissions: [] });

            const result = await repository.findPaginated({ limit: 10, offset: 10 });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(1);
        });

        it('filters by searchQuery (case-insensitive substring on roleName)', async () => {
            await repository.create({ roleName: 'trader-eu', systemPermissions: [] });
            await repository.create({ roleName: 'TRADER-US', systemPermissions: [] });
            await repository.create({ roleName: 'auditor', systemPermissions: [] });

            const result = await repository.findPaginated({ limit: 10, offset: 0, searchQuery: 'trader' });

            const names = result.items.map((r) => r.roleName).sort();
            expect(names).toEqual(['TRADER-US', 'trader-eu']);
            expect(result.pagination.totalItems).toBe(2);
        });

        it('treats LIKE wildcards in searchQuery literally', async () => {
            await repository.create({ roleName: 'admin_panel', systemPermissions: [] });
            await repository.create({ roleName: 'adminXpanel', systemPermissions: [] });

            // `_` is a single-char wildcard in ILIKE; without escaping `admin_` would also match `adminXpanel`.
            const result = await repository.findPaginated({ limit: 10, offset: 0, searchQuery: 'admin_' });

            expect(result.items.map((r) => r.roleName)).toEqual(['admin_panel']);
            expect(result.pagination.totalItems).toBe(1);
        });

        it('returns roles ordered by roleName across pages', async () => {
            await repository.create({ roleName: 'charlie', systemPermissions: [] });
            await repository.create({ roleName: 'alpha', systemPermissions: [] });
            await repository.create({ roleName: 'bravo', systemPermissions: [] });

            const page1 = await repository.findPaginated({ limit: 2, offset: 0 });
            const page2 = await repository.findPaginated({ limit: 2, offset: 2 });

            expect(page1.items.map((r) => r.roleName)).toEqual(['alpha', 'bravo']);
            expect(page2.items.map((r) => r.roleName)).toEqual(['charlie']);
        });

        it('returns zero counts when nothing references the role', async () => {
            await repository.create({ roleName: 'lonely-role', systemPermissions: [] });

            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            const role = result.items.find((r) => r.roleName === 'lonely-role');
            expect(role).toBeDefined();
            expect(role?.usersCount).toBe(0);
            expect(role?.contractPermissionsCount).toBe(0);
        });

        it('counts users assigned to the role', async ({ db }) => {
            const withUsersRole = await repository.create({ roleName: 'with-users', systemPermissions: [] });
            await repository.create({ roleName: 'no-users', systemPermissions: [] });

            const usersRepo = new UsersRepository(db);
            await usersRepo.create({
                oidcSub: 'sub-a',
                displayName: 'User A',
                source: UserSources.enum.adminPanel,
                roles: [withUsersRole.id]
            });
            await usersRepo.create({
                oidcSub: 'sub-b',
                displayName: 'User B',
                source: UserSources.enum.adminPanel,
                roles: [withUsersRole.id]
            });

            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            const withUsers = result.items.find((r) => r.roleName === 'with-users');
            const noUsers = result.items.find((r) => r.roleName === 'no-users');
            expect(withUsers?.usersCount).toBe(2);
            expect(noUsers?.usersCount).toBe(0);
        });

        it('counts contract function permissions that reference the role', async ({ db }) => {
            const withPermissionsRole = await repository.create({
                roleName: 'with-permissions',
                systemPermissions: []
            });
            await repository.create({ roleName: 'no-permissions', systemPermissions: [] });

            const contractsRepo = new ContractsRepository(db);
            const contractAddress = '0x1234567890123456789012345678901234567890';
            await contractsRepo.create({
                contractAddress,
                abi: JSON.stringify([
                    {
                        type: 'function',
                        name: 'transfer',
                        inputs: [
                            { name: 'to', type: 'address' },
                            { name: 'amount', type: 'uint256' }
                        ],
                        outputs: [{ name: '', type: 'bool' }],
                        stateMutability: 'nonpayable'
                    },
                    {
                        type: 'function',
                        name: 'approve',
                        inputs: [
                            { name: 'spender', type: 'address' },
                            { name: 'amount', type: 'uint256' }
                        ],
                        outputs: [{ name: '', type: 'bool' }],
                        stateMutability: 'nonpayable'
                    }
                ]),
                name: 'Test Token',
                description: 'A test token',
                discloseErc20TotalSupply: false,
                discloseBytecode: false,
                disclosureStartBlock: '0x0'
            });

            const permissionsRepo = new ContractFunctionPermissionsRepository(db);
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRole',
                roles: [{ id: withPermissionsRole.id }]
            });
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function approve(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRole',
                roles: [{ id: withPermissionsRole.id }]
            });

            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            const withPermissions = result.items.find((r) => r.roleName === 'with-permissions');
            const noPermissions = result.items.find((r) => r.roleName === 'no-permissions');
            expect(withPermissions?.contractPermissionsCount).toBe(2);
            expect(noPermissions?.contractPermissionsCount).toBe(0);
        });

        it('scopes counts per row when multiple roles are on the same page', async ({ db }) => {
            const roleARow = await repository.create({ roleName: 'role-a', systemPermissions: [] });
            const roleBRow = await repository.create({ roleName: 'role-b', systemPermissions: [] });

            const usersRepo = new UsersRepository(db);
            await usersRepo.create({
                oidcSub: 'sub-a-1',
                displayName: 'User A1',
                source: UserSources.enum.adminPanel,
                roles: [roleARow.id]
            });
            await usersRepo.create({
                oidcSub: 'sub-a-2',
                displayName: 'User A2',
                source: UserSources.enum.adminPanel,
                roles: [roleARow.id]
            });
            await usersRepo.create({
                oidcSub: 'sub-b',
                displayName: 'User B',
                source: UserSources.enum.adminPanel,
                roles: [roleBRow.id]
            });

            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            const roleA = result.items.find((r) => r.roleName === 'role-a');
            const roleB = result.items.find((r) => r.roleName === 'role-b');
            expect(roleA?.usersCount).toBe(2);
            expect(roleB?.usersCount).toBe(1);
        });
    });

    describe('createOrUpdateAdminRole', () => {
        it('creates the admin role with the stable id if it does not exist', async () => {
            await expect(repository.findScoped(ADMIN_ROLE_ID)).resolves.toBeUndefined();
            const created = await repository.createOrUpdateAdminRole();
            expect(created.id).toEqual(ADMIN_ROLE_ID);
            const adminRole = await repository.findScoped(ADMIN_ROLE_ID);
            expect(adminRole?.id).toEqual(ADMIN_ROLE_ID);
            expect(adminRole?.roleName).toEqual('admin');
            expect(adminRole?.isSystemRole).toEqual(true);
            expect(adminRole?.systemPermissions?.sort()).toEqual(SystemPermissions.options.sort());
        });

        it('syncs system permissions when admin role already exists with stale permissions', async ({ db }) => {
            // Simulate an admin role created before a new permission was added
            await db.insert(rolesTable).values({
                id: ADMIN_ROLE_ID,
                roleName: 'admin',
                systemPermissions: ['full_sequencer_rpc_access'],
                isSystemRole: true
            });

            await repository.createOrUpdateAdminRole();
            const adminRole = await repository.findScoped(ADMIN_ROLE_ID);
            expect(adminRole?.systemPermissions?.sort()).toEqual(SystemPermissions.options.sort());
        });

        it('can be called multiple times without duplicating the role', async () => {
            await expect(repository.findScoped(ADMIN_ROLE_ID)).resolves.toBeUndefined();
            await repository.createOrUpdateAdminRole();
            await repository.createOrUpdateAdminRole();
            await repository.createOrUpdateAdminRole();
            const adminRole = await repository.findScoped(ADMIN_ROLE_ID);
            expect(adminRole?.id).toEqual(ADMIN_ROLE_ID);
            expect(adminRole?.roleName).toEqual('admin');
            expect(adminRole?.isSystemRole).toEqual(true);
            expect(adminRole?.systemPermissions?.sort()).toEqual(SystemPermissions.options.sort());
        });
    });
});
