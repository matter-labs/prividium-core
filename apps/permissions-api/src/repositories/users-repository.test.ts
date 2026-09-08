import { eq } from 'drizzle-orm';
import type { Address } from 'viem';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { auditLogsTable, organizationsTable, UserSources, usersTable } from '../db/schema';
import { EntityAlreadyExistsError, EntityNotFound } from '../utils/error-types';
import { AuditLogsRepository } from './audit-logs-repository';
import { RolesRepository } from './roles-repository';
import type { User } from './users-repository';
import { UsersRepository } from './users-repository';

describe('UsersRepository', () => {
    let repository: UsersRepository;
    let rolesRepo: RolesRepository;
    const roleIdsByName = new Map<string, string>();

    beforeEach<Fixture>(async ({ db }) => {
        rolesRepo = new RolesRepository(db);
        roleIdsByName.clear();
        repository = new UsersRepository(db);
    });

    afterEach(async () => {
        vi.clearAllMocks();
    });

    describe('create', () => {
        it('should crete a new role with provided data when all data is right', async () => {
            await createRole('role1');
            await createRole('role2');

            const newUser = {
                oidcSub: 'oidc-sub-123',
                displayName: 'Test User',
                roles: roleIds('role1', 'role2'),
                wallets: [
                    '0x1234567890123456789012345678901234567890' as Address,
                    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address
                ],
                source: UserSources.enum.adminPanel
            };

            const user = await repository.create(newUser);

            expect(user.oidcSub).toEqual('oidc-sub-123');

            expect(user).toBeDefined();
            expect(user.oidcSub).toBe(newUser.oidcSub);
            expect(user.displayName).toBe(newUser.displayName);
            expectRoles(user, ['role1', 'role2']);
            expectWallets(user, newUser.wallets);
        });

        it('should throw an error if a role does not exist', async () => {
            const existing = await rolesRepo.create({
                roleName: 'existingrole',
                systemPermissions: []
            });

            const newUser = {
                oidcSub: 'oidc-sub-123',
                displayName: 'Test User',
                roles: [existing.id, 'does-not-exist-id'],
                wallets: [
                    '0x1234567890123456789012345678901234567890' as Address,
                    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address
                ],
                source: UserSources.enum.adminPanel
            };

            await expect(repository.create(newUser)).rejects.toThrow(
                new EntityNotFound('role', { id: 'does-not-exist-id' })
            );

            await expect(repository.findByOidcSub('oidc-sub-123')).resolves.toBeUndefined();
        });

        it('should throw EntityAlreadyExistsError when (oidcIssuer, oidcSub) already exists', async () => {
            const newUser = {
                oidcSub: 'duplicate-sub',
                oidcIssuer: 'https://issuer.test/',
                displayName: 'User 1',
                source: UserSources.enum.oidc
            };

            await repository.create(newUser);

            await expect(
                repository.create({
                    oidcSub: 'duplicate-sub',
                    oidcIssuer: 'https://issuer.test/',
                    displayName: 'User 2',
                    source: UserSources.enum.oidc
                })
            ).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should throw EntityAlreadyExistsError when wallet is already assigned to another user', async () => {
            const wallet = '0x1234567890123456789012345678901234567890' as Address;

            await repository.create({
                oidcSub: 'user1',
                displayName: 'User 1',
                wallets: [wallet],
                source: 'adminPanel'
            });

            await expect(
                repository.create({
                    oidcSub: 'user2',
                    displayName: 'User 2',
                    wallets: [wallet],
                    source: 'adminPanel'
                })
            ).rejects.toThrow(EntityAlreadyExistsError);
        });
    });

    describe('findById', () => {
        it('should find user by ID with roles and wallets or return undefined', async () => {
            await createRole('viewer');
            const created = await repository.create({
                oidcSub: 'find-by-id-sub',
                displayName: 'Find By ID User',
                roles: roleIds('viewer'),
                wallets: ['0x1234567890123456789012345678901234567890' as Address],
                source: 'adminPanel'
            });

            const found = await repository.findById(created.id);
            expect(found).toBeDefined();
            expect(found?.id).toBe(created.id);
            expectRoles(found, ['viewer']);
            expectWallets(found, ['0x1234567890123456789012345678901234567890' as Address]);

            const notFound = await repository.findById('non-existent-id');
            expect(notFound).toBeUndefined();
        });

        it('includes organization membership when present', async ({ db }) => {
            const organizationId = 'org-find-by-id';
            await db.insert(organizationsTable).values({ id: organizationId, name: 'Org FindById' });
            const created = await repository.create({
                oidcSub: 'find-by-id-org-sub',
                displayName: 'Find By ID Org User',
                source: 'adminPanel'
            });
            await db.update(usersTable).set({ organizationId }).where(eq(usersTable.id, created.id));

            const found = await repository.findById(created.id);

            expect(found?.organizationId).toBe(organizationId);
            expect(found?.organization).toEqual({ id: organizationId, name: 'Org FindById', deletedAt: null });
        });
    });

    describe('findBySub', () => {
        it('should find user by oidcSub with roles and wallets or return undefined', async () => {
            await createRole('editor');
            const oidcSub = 'find-by-sub-test';
            await repository.create({
                oidcSub,
                displayName: 'Find By Sub User',
                roles: roleIds('editor'),
                wallets: ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address],
                source: 'adminPanel'
            });

            const found = await repository.findByOidcSub(oidcSub);
            expect(found).toBeDefined();
            expect(found?.oidcSub).toBe(oidcSub);
            expectRoles(found, ['editor']);
            expectWallets(found, ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address]);

            const notFound = await repository.findByOidcSub('non-existent-sub');
            expect(notFound).toBeUndefined();
        });
    });

    describe('update', () => {
        it('should successfully update displayName', async () => {
            const user = await repository.create({
                oidcSub: 'update-display-name',
                displayName: 'Original Name',
                source: 'adminPanel'
            });

            const updated = await repository.update(user.id, {
                displayName: 'Updated Name'
            });

            expect(updated.displayName).toBe('Updated Name');
        });

        it('should successfully update roles (replaces existing)', async () => {
            await createRole('viewer');
            await createRole('editor');
            const user = await repository.create({
                oidcSub: 'update-roles',
                displayName: 'User',
                roles: roleIds('viewer', 'editor'),
                source: 'adminPanel'
            });

            const updated = await repository.update(user.id, {
                roles: roleIds('viewer')
            });

            expectRoles(updated, ['viewer']);
        });

        it('should successfully update wallet addresses (replaces existing)', async () => {
            const user = await repository.create({
                oidcSub: 'update-wallets',
                displayName: 'User',
                wallets: ['0x1111111111111111111111111111111111111111' as Address],
                source: 'adminPanel'
            });

            const newWallet = '0x2222222222222222222222222222222222222222' as Address;
            const updated = await repository.update(user.id, {
                wallets: [newWallet]
            });

            expectWallets(updated, [newWallet]);
        });

        it('should successfully remove all roles when empty array provided', async () => {
            await createRole('existingrole');
            const user = await repository.create({
                oidcSub: 'remove-all-roles',
                displayName: 'User',
                roles: roleIds('existingrole'),
                source: 'adminPanel'
            });

            const updated = await repository.update(user.id, {
                roles: []
            });

            expectRoles(updated, []);
        });

        it('should successfully remove all wallets when empty array provided', async () => {
            const user = await repository.create({
                oidcSub: 'remove-all-wallets',
                displayName: 'User',
                wallets: ['0x3333333333333333333333333333333333333333' as Address],
                source: 'adminPanel'
            });

            const updated = await repository.update(user.id, {
                wallets: []
            });

            expectWallets(updated, []);
        });

        it('should throw InvalidInputError when user does not exist', async () => {
            await expect(
                repository.update('non-existent-id', {
                    displayName: 'New Name'
                })
            ).rejects.toThrowError('not found');
        });

        it('should throw EntityAlreadyExistsError when assigning wallet already used by another user', async () => {
            const wallet = '0x4444444444444444444444444444444444444444' as Address;

            await repository.create({
                oidcSub: 'user1-wallet-conflict',
                displayName: 'User 1',
                wallets: [wallet],
                source: 'adminPanel'
            });

            const user2 = await repository.create({
                oidcSub: 'user2-wallet-conflict',
                displayName: 'User 2',
                source: 'adminPanel'
            });

            await expect(
                repository.update(user2.id, {
                    wallets: [wallet]
                })
            ).rejects.toThrow(EntityAlreadyExistsError);
        });
    });

    describe('delete', () => {
        it('should successfully delete existing user and return true', async () => {
            const user = await repository.create({
                oidcSub: 'delete-test',
                displayName: 'To Delete',
                source: 'adminPanel'
            });

            const result = await repository.delete(user.id);
            expect(result).toBe(true);

            const found = await repository.findById(user.id);
            expect(found).toBeUndefined();
        });

        it('should return false for non-existent user', async () => {
            const result = await repository.delete('non-existent-id');
            expect(result).toBe(false);
        });

        // regression for #1280: audit_logs has no FK to users, so deleting a user must not remove its audit rows
        it('preserves audit_logs rows referencing a user after the user is deleted', async ({ db }) => {
            const user = await repository.create({
                oidcSub: 'audit-preserve-test',
                displayName: 'Audit Actor',
                source: 'adminPanel'
            });

            const auditLogs = new AuditLogsRepository(db);
            const auditLog = await auditLogs.create({
                activeUserId: user.id,
                actorType: 'user',
                actionType: 'user.delete',
                actionDetails: { reason: 'regression #1280' }
            });

            const deleted = await repository.delete(user.id);
            expect(deleted).toBe(true);

            const [surviving] = await db.select().from(auditLogsTable).where(eq(auditLogsTable.id, auditLog.id));
            expect(surviving).toBeDefined();
            // actor id is preserved unchanged (not nulled, not removed)
            expect(surviving!.activeUserId).toBe(user.id);
        });
    });

    describe('findPaginated', () => {
        it('should return paginated results with correct pagination metadata and includes roles/wallets', async () => {
            // Create multiple users
            for (let i = 0; i < 5; i++) {
                await createRole(`role${i}`);
                await repository.create({
                    oidcSub: `paginated-user-${i}`,
                    displayName: `User ${i}`,
                    roles: roleIds(`role${i}`),
                    wallets: [`0x${i.toString().padStart(40, '0')}`],
                    source: 'adminPanel'
                });
            }

            const result = await repository.findPaginated({ limit: 2, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination.totalItems).toBe(5);
            expect(result.pagination.totalPages).toBe(3);
            expect(result.pagination.currentPage).toBe(1);
            expect(result.pagination.limit).toBe(2);
            expect(result.pagination.offset).toBe(0);

            // Check that roles and wallets are included
            expectRoles(result.items[0], ['role0']);
            expectWallets(result.items[0], ['0x0000000000000000000000000000000000000000' as Address]);
        });

        it('lists zone users only by default, and members after them with scope=all', async ({ db }) => {
            const organizationId = 'org-paginated';
            await db.insert(organizationsTable).values({ id: organizationId, name: 'Org Paginated' });
            const orgUser = await repository.create({
                oidcSub: 'paginated-org-user',
                displayName: 'Paginated Org User',
                source: 'adminPanel'
            });
            await db.update(usersTable).set({ organizationId }).where(eq(usersTable.id, orgUser.id));
            const zoneUser = await repository.create({
                oidcSub: 'paginated-zone-user',
                displayName: 'Paginated Zone User',
                source: 'adminPanel'
            });

            const zoneIds = (await repository.findPaginated({ limit: 10, offset: 0 })).items.map((item) => item.id);
            expect(zoneIds).toContain(zoneUser.id);
            expect(zoneIds).not.toContain(orgUser.id);

            const grouped = (
                await repository.findPaginated({ limit: 10, offset: 0, scope: 'all', sort: 'organization' })
            ).items.map((item) => item.id);
            expect(grouped.indexOf(orgUser.id)).toBeGreaterThan(grouped.indexOf(zoneUser.id));
        });

        it('omits members of a soft-deleted organization from every scope', async ({ db }) => {
            const organizationId = 'org-deleted-page';
            await db.insert(organizationsTable).values({ id: organizationId, name: 'Org Deleted' });
            const orgUser = await repository.create({
                oidcSub: 'deleted-org-user',
                displayName: 'Deleted Org User',
                source: 'adminPanel'
            });
            await db.update(usersTable).set({ organizationId }).where(eq(usersTable.id, orgUser.id));
            await db
                .update(organizationsTable)
                .set({ deletedAt: new Date() })
                .where(eq(organizationsTable.id, organizationId));

            const all = await repository.findPaginated({ limit: 10, offset: 0, scope: 'all' });
            expect(all.items.map((item) => item.id)).not.toContain(orgUser.id);

            const scoped = await repository.findPaginated({ limit: 10, offset: 0, organizationId });
            expect(scoped.items).toEqual([]);
            expect(scoped.pagination.totalItems).toBe(0);
        });

        it('returns only the given organization when scoped to one', async ({ db }) => {
            const organizationId = 'org-scoped-page';
            await db.insert(organizationsTable).values({ id: organizationId, name: 'Org Scoped' });
            const orgUser = await repository.create({
                oidcSub: 'scoped-org-user',
                displayName: 'Scoped Org User',
                source: 'adminPanel'
            });
            await db.update(usersTable).set({ organizationId }).where(eq(usersTable.id, orgUser.id));
            const zoneUser = await repository.create({
                oidcSub: 'scoped-zone-user',
                displayName: 'Scoped Zone User',
                source: 'adminPanel'
            });

            const scoped = (await repository.findPaginated({ limit: 10, offset: 0, organizationId })).items;
            expect(scoped.map((item) => item.id)).toEqual([orgUser.id]);

            const zoneOnly = (await repository.findPaginated({ limit: 10, offset: 0, scope: 'zone' })).items;
            expect(zoneOnly.map((item) => item.id)).toContain(zoneUser.id);
            expect(zoneOnly.map((item) => item.id)).not.toContain(orgUser.id);
        });
    });

    describe('organizationIdByIds', () => {
        it('maps each user id to its organization, with null for zone-level users', async ({ db }) => {
            const organizationId = 'org-membership';
            await db.insert(organizationsTable).values({ id: organizationId, name: 'Org Membership' });
            const orgUser = await repository.create({
                oidcSub: 'membership-org-user',
                displayName: 'Membership Org User',
                source: 'adminPanel'
            });
            await db.update(usersTable).set({ organizationId }).where(eq(usersTable.id, orgUser.id));
            const zoneUser = await repository.create({
                oidcSub: 'membership-zone-user',
                displayName: 'Membership Zone User',
                source: 'adminPanel'
            });

            const membership = await repository.organizationIdByIds([orgUser.id, zoneUser.id, 'missing']);

            expect(membership.get(orgUser.id)).toBe(organizationId);
            expect(membership.get(zoneUser.id)).toBeNull();
            expect(membership.has('missing')).toBe(false);
        });

        it('returns an empty map for no ids', async () => {
            expect((await repository.organizationIdByIds([])).size).toBe(0);
        });
    });

    describe('checkUserAddress', () => {
        it('should return true when user has the wallet address, false otherwise', async () => {
            const wallet = '0x5555555555555555555555555555555555555555' as Address;
            const otherWallet = '0x6666666666666666666666666666666666666666' as Address;

            const user = await repository.create({
                oidcSub: 'check-address-test',
                displayName: 'User',
                wallets: [wallet],
                source: 'adminPanel'
            });

            const hasWallet = await repository.checkUserAddress(user.id, wallet);
            expect(hasWallet).toBe(true);

            const doesNotHaveWallet = await repository.checkUserAddress(user.id, otherWallet);
            expect(doesNotHaveWallet).toBe(false);
        });
    });

    describe('backfillMissingOidcIssuer', () => {
        it('sets the issuer on OIDC users that lack one, leaving others untouched', async () => {
            const missing = await repository.create({
                oidcSub: 'sub-missing',
                displayName: 'Missing Issuer',
                source: UserSources.enum.oidc
            });
            const alreadySet = await repository.create({
                oidcSub: 'sub-existing',
                oidcIssuer: 'https://existing.issuer/',
                displayName: 'Has Issuer',
                source: UserSources.enum.oidc
            });
            const nonOidc = await repository.createFromAdminApi({
                displayName: 'Admin User',
                roles: [],
                wallets: []
            });

            await repository.backfillMissingOidcIssuer('https://zone.issuer/');

            expect((await repository.findById(missing.id))?.oidcIssuer).toBe('https://zone.issuer/');
            expect((await repository.findById(alreadySet.id))?.oidcIssuer).toBe('https://existing.issuer/');
            expect((await repository.findById(nonOidc.id))?.oidcIssuer).toBeNull();
        });
    });

    // Creates a role and records its id so tests can assign it by name.
    async function createRole(roleName: string): Promise<string> {
        const role = await rolesRepo.create({ roleName, systemPermissions: [] });
        roleIdsByName.set(roleName, role.id);
        return role.id;
    }

    function roleIds(...roleNames: string[]): string[] {
        return roleNames.map((name) => {
            const id = roleIdsByName.get(name);
            if (id === undefined) throw new Error(`test role "${name}" was not created`);
            return id;
        });
    }
});

// Helper functions for testing
function expectRoles(user: User | undefined, expectedRoles: string[]) {
    expect(user?.roles).toHaveLength(expectedRoles.length);
    const roleNames = user?.roles?.map((r) => r.roleName) || [];
    expect(roleNames).toEqual(expect.arrayContaining(expectedRoles));
}

function expectWallets(user: User | undefined, expectedWallets: Address[]) {
    expect(user?.wallets).toHaveLength(expectedWallets.length);
    const wallets = user?.wallets?.map((w) => w.walletAddress.toLowerCase()) || [];
    const expectedAddresses = expectedWallets.map((a) => a.toLowerCase());
    expect(wallets).toEqual(expect.arrayContaining(expectedAddresses));
}
