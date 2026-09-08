import { eq } from 'drizzle-orm';
import type { Address } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import {
    m2mApplicationsOrganizationsTable,
    m2mApplicationsTable,
    m2mAppRolesTable,
    organizationsTable,
    rolesTable
} from '../db/schema';
import { EntityNotFound } from '../utils/error-types';
import { IpWhitelistRepository } from './ip-whitelist-repository';
import { M2mApplicationsRepository } from './m2m-applications-repository';
import { OrganizationsRepository } from './organizations-repository';
import { RolesRepository } from './roles-repository';
import { UsersRepository } from './users-repository';

describe('M2mApplicationsRepository', () => {
    let repository: M2mApplicationsRepository;
    let rolesRepo: RolesRepository;
    let usersRepo: UsersRepository;
    let orgsRepo: OrganizationsRepository;
    let ipWhitelistRepo: IpWhitelistRepository;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new M2mApplicationsRepository(db);
        rolesRepo = new RolesRepository(db);
        usersRepo = new UsersRepository(db);
        orgsRepo = new OrganizationsRepository(db);
        ipWhitelistRepo = new IpWhitelistRepository(db);
    });

    describe('create', () => {
        it('creates an m2m app without roles', async () => {
            const created = await repository.create({
                name: 'Created M2M App',
                description: null,
                roles: []
            });

            expect(created.id).toHaveLength(21);
            expect(created.name).toBe('Created M2M App');
            expect(created.description).toBeNull();
            expect(created.roles).toEqual([]);
            expect(created.createdAt).toBeInstanceOf(Date);
            expect(created.updatedAt).toBeInstanceOf(Date);
        });

        it('creates an m2m app with associated roles', async () => {
            const viewerRole = await rolesRepo.create({ roleName: 'viewer', systemPermissions: [] });
            const editorRole = await rolesRepo.create({ roleName: 'editor', systemPermissions: [] });

            const created = await repository.create({
                name: 'Role-backed M2M App',
                description: 'Repository test app',
                roles: [{ id: viewerRole.id }, { id: editorRole.id }]
            });

            expect(created.roles).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ roleName: viewerRole.roleName, isSystemRole: false }),
                    expect.objectContaining({ roleName: editorRole.roleName, isSystemRole: false })
                ])
            );
        });

        it('throws if try to associate a role that does not exist', async () => {
            await expect(
                repository.create({
                    name: 'Invalid M2M App',
                    description: null,
                    roles: [{ id: 'doesnotexist' }]
                })
            ).rejects.toThrow(EntityNotFound);
        });

        it('creates an m2m app with linked organizations', async () => {
            const org1 = await orgsRepo.create({ name: 'Org 1', defaultRoles: [] });
            const org2 = await orgsRepo.create({ name: 'Org 2', defaultRoles: [] });

            const created = await repository.create({
                name: 'M2M With Orgs',
                description: null,
                roles: [],
                organizationIds: [org1.id, org2.id]
            });

            const organizations = await repository.getOrganizations(created.id);
            expect(organizations).toHaveLength(2);
            expect(organizations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: org1.id, name: 'Org 1' }),
                    expect.objectContaining({ id: org2.id, name: 'Org 2' })
                ])
            );
        });

        it('creates an m2m app with roles and organizations together', async () => {
            const role = await rolesRepo.create({ roleName: 'viewer', systemPermissions: [] });
            const org = await orgsRepo.create({ name: 'Org', defaultRoles: [] });

            const created = await repository.create({
                name: 'M2M With Both',
                description: 'has roles and orgs',
                roles: [{ id: role.id }],
                organizationIds: [org.id]
            });

            expect(created.roles).toEqual([expect.objectContaining({ id: role.id, roleName: 'viewer' })]);

            const organizations = await repository.getOrganizations(created.id);
            expect(organizations).toEqual([expect.objectContaining({ id: org.id })]);
        });

        it('creates an m2m app with no organizationIds (undefined)', async () => {
            const created = await repository.create({
                name: 'No Orgs',
                description: null,
                roles: []
            });

            const organizations = await repository.getOrganizations(created.id);
            expect(organizations).toEqual([]);
        });

        it('creates an m2m app with empty organizationIds array', async () => {
            const created = await repository.create({
                name: 'Empty Orgs',
                description: null,
                roles: [],
                organizationIds: []
            });

            const organizations = await repository.getOrganizations(created.id);
            expect(organizations).toEqual([]);
        });

        it('throws if an organization does not exist during create', async () => {
            await expect(
                repository.create({
                    name: 'Invalid Orgs',
                    description: null,
                    roles: [],
                    organizationIds: ['nonexistent-org']
                })
            ).rejects.toThrow(EntityNotFound);
        });

        it('deduplicates organization IDs during create', async () => {
            const org = await orgsRepo.create({ name: 'Org', defaultRoles: [] });

            const created = await repository.create({
                name: 'Dedup Orgs',
                description: null,
                roles: [],
                organizationIds: [org.id, org.id]
            });

            const organizations = await repository.getOrganizations(created.id);
            expect(organizations).toHaveLength(1);
            expect(organizations).toEqual([expect.objectContaining({ id: org.id })]);
        });
    });

    it('#getById returns the m2m app with flattened roles', async ({ db }) => {
        const m2mAppId = 'm2m-app-1';

        const [viewerRole, editorRole] = await db
            .insert(rolesTable)
            .values([
                { id: 'role-viewer', roleName: 'viewer', systemPermissions: [], isSystemRole: false },
                { id: 'role-editor', roleName: 'editor', systemPermissions: [], isSystemRole: false }
            ])
            .returning();
        await db.insert(m2mApplicationsTable).values({
            id: m2mAppId,
            name: 'Test M2M App',
            description: 'Repository test app'
        });
        await db.insert(m2mAppRolesTable).values([
            { m2mAppId, roleId: viewerRole!.id },
            { m2mAppId, roleId: editorRole!.id }
        ]);

        const result = await repository.getById(m2mAppId);

        expect(result.id).toBe(m2mAppId);
        expect(result.name).toBe('Test M2M App');
        expect(result.description).toBe('Repository test app');
        expect(result.roles).toHaveLength(2);
        expect(result.roles).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ roleName: 'viewer', isSystemRole: false }),
                expect.objectContaining({ roleName: 'editor', isSystemRole: false })
            ])
        );
    });

    it('#getById throws EntityNotFound when the m2m app does not exist', async () => {
        await expect(repository.getById('does-not-exist')).rejects.toThrow(
            new EntityNotFound('M2mApplication', { id: 'does-not-exist' })
        );
    });

    describe('searchPaginated', () => {
        it('returns empty list when no m2m apps exist', async () => {
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

        it('returns created m2m apps ordered by creation date', async () => {
            for (let i = 0; i < 3; i++) {
                await repository.create({
                    name: `m2m-app-${i}`,
                    description: null,
                    roles: []
                });
            }

            const result = await repository.searchPaginated({ limit: 2, offset: 0 });

            expect(result.pagination).toEqual({
                currentPage: 1,
                limit: 2,
                offset: 0,
                totalItems: 3,
                totalPages: 2
            });
            expect(result.items).toHaveLength(2);
            expect(result.items.map((item) => item.name)).toEqual(['m2m-app-0', 'm2m-app-1']);
        });
    });

    describe('hasOverbroadIpWhitelist', () => {
        it('sets hasOverbroadIpWhitelist=true when any whitelist entry is overbroad (getById)', async () => {
            const created = await repository.create({ name: 'overbroad-app', description: null, roles: [] });
            await ipWhitelistRepo.create({ m2mAppId: created.id, ipAddress: '10.42.0.0/16' });
            await ipWhitelistRepo.create({ m2mAppId: created.id, ipAddress: '0.0.0.0/0' }, { allowAnyCidr: true });

            const result = await repository.getById(created.id);

            expect(result.hasOverbroadIpWhitelist).toBe(true);
        });

        it('sets hasOverbroadIpWhitelist=false when all entries are tight CIDRs or plain IPs', async () => {
            const created = await repository.create({ name: 'tight-app', description: null, roles: [] });
            await ipWhitelistRepo.create({ m2mAppId: created.id, ipAddress: '10.42.0.0/16' });
            await ipWhitelistRepo.create({ m2mAppId: created.id, ipAddress: '192.168.1.1' });

            const result = await repository.getById(created.id);

            expect(result.hasOverbroadIpWhitelist).toBe(false);
        });

        it('sets hasOverbroadIpWhitelist=false for an app with no whitelist entries', async () => {
            const created = await repository.create({ name: 'empty-whitelist-app', description: null, roles: [] });

            const result = await repository.getById(created.id);

            expect(result.hasOverbroadIpWhitelist).toBe(false);
        });

        it('does not include raw ipWhitelist entries in the returned shape', async () => {
            const created = await repository.create({ name: 'no-raw-entries-app', description: null, roles: [] });
            await ipWhitelistRepo.create({ m2mAppId: created.id, ipAddress: '192.168.1.1' });

            const result = await repository.getById(created.id);

            expect(result).not.toHaveProperty('ipWhitelist');
        });

        it('returns hasOverbroadIpWhitelist=false from create', async () => {
            const created = await repository.create({ name: 'freshly-created-app', description: null, roles: [] });

            expect(created.hasOverbroadIpWhitelist).toBe(false);
        });

        it('returns hasOverbroadIpWhitelist=false from createForOrg', async () => {
            const org = await orgsRepo.create({ name: 'Org', defaultRoles: [] });

            const created = await repository.createForOrg(org.id, { name: 'org-app', roles: [] });

            expect(created.hasOverbroadIpWhitelist).toBe(false);
        });

        it('reflects the overbroad flag in searchPaginated for the seeded app and false for a clean one', async () => {
            const overbroadApp = await repository.create({
                name: 'search-overbroad-app',
                description: null,
                roles: []
            });
            await ipWhitelistRepo.create({ m2mAppId: overbroadApp.id, ipAddress: '0.0.0.0/0' }, { allowAnyCidr: true });
            const cleanApp = await repository.create({ name: 'search-clean-app', description: null, roles: [] });
            await ipWhitelistRepo.create({ m2mAppId: cleanApp.id, ipAddress: '192.168.1.1' });

            const result = await repository.searchPaginated({ limit: 10, offset: 0 });

            expect(result.items.find((item) => item.id === overbroadApp.id)?.hasOverbroadIpWhitelist).toBe(true);
            expect(result.items.find((item) => item.id === cleanApp.id)?.hasOverbroadIpWhitelist).toBe(false);
        });

        it('reflects the overbroad flag in searchPaginatedForOrg for the seeded app and false for a clean one', async () => {
            const org = await orgsRepo.create({ name: 'IP Whitelist Org', defaultRoles: [] });
            const overbroadApp = await repository.createForOrg(org.id, { name: 'org-overbroad-app', roles: [] });
            await ipWhitelistRepo.create({ m2mAppId: overbroadApp.id, ipAddress: '0.0.0.0/0' }, { allowAnyCidr: true });
            const cleanApp = await repository.createForOrg(org.id, { name: 'org-clean-app', roles: [] });
            await ipWhitelistRepo.create({ m2mAppId: cleanApp.id, ipAddress: '192.168.1.1' });

            const result = await repository.searchPaginatedForOrg(org.id, { limit: 10, offset: 0 });

            expect(result.items.find((item) => item.id === overbroadApp.id)?.hasOverbroadIpWhitelist).toBe(true);
            expect(result.items.find((item) => item.id === cleanApp.id)?.hasOverbroadIpWhitelist).toBe(false);
        });
    });

    describe('update', () => {
        it('updates an m2m app and replaces its roles', async () => {
            const originalRole = await rolesRepo.create({ roleName: 'original-role', systemPermissions: [] });
            const replacementRole = await rolesRepo.create({ roleName: 'replacement-role', systemPermissions: [] });
            const created = await repository.create({
                name: 'Original M2M App',
                description: 'original description',
                roles: [{ id: originalRole.id }]
            });

            const updated = await repository.update(created.id, {
                ...created,
                name: 'Updated M2M App',
                description: null,
                roles: [replacementRole]
            });

            expect(updated.name).toBe('Updated M2M App');
            expect(updated.description).toBeNull();
            expect(updated.roles).toEqual([expect.objectContaining({ id: replacementRole.id })]);

            await expect(repository.getById(created.id)).resolves.toEqual(updated);
        });
    });

    describe('organization selection', () => {
        it('returns the selected organizations for an m2m app', async ({ db }) => {
            const created = await repository.create({
                name: 'M2M With Organizations',
                description: null,
                roles: []
            });

            await db.insert(organizationsTable).values([
                { id: 'org-1', name: 'Organization One' },
                { id: 'org-2', name: 'Organization Two' }
            ]);
            await db.insert(m2mApplicationsOrganizationsTable).values([
                { m2mAppId: created.id, organizationId: 'org-1' },
                { m2mAppId: created.id, organizationId: 'org-2' }
            ]);

            const organizations = await repository.getOrganizations(created.id);

            expect(organizations).toEqual([
                expect.objectContaining({ id: 'org-1', name: 'Organization One' }),
                expect.objectContaining({ id: 'org-2', name: 'Organization Two' })
            ]);
        });

        it('replaces the selected organizations for an m2m app', async ({ db }) => {
            const created = await repository.create({
                name: 'M2M With Organizations',
                description: null,
                roles: []
            });

            await db.insert(organizationsTable).values([
                { id: 'org-1', name: 'Organization One' },
                { id: 'org-2', name: 'Organization Two' },
                { id: 'org-3', name: 'Organization Three' }
            ]);
            await db.insert(m2mApplicationsOrganizationsTable).values([
                { m2mAppId: created.id, organizationId: 'org-1' },
                { m2mAppId: created.id, organizationId: 'org-2' }
            ]);

            const organizations = await repository.replaceOrganizations(created.id, ['org-3']);

            expect(organizations).toEqual([expect.objectContaining({ id: 'org-3', name: 'Organization Three' })]);

            const links = await db.query.m2mApplicationsOrganizationsTable.findMany({
                where: (t, { eq }) => eq(t.m2mAppId, created.id)
            });
            expect(links).toEqual([expect.objectContaining({ organizationId: 'org-3' })]);
        });

        it('creates an audit log when replacing the selected organizations', async ({ db }) => {
            const created = await repository.create({
                name: 'M2M With Organizations',
                description: null,
                roles: []
            });

            await db.insert(organizationsTable).values([
                { id: 'org-1', name: 'Organization One' },
                { id: 'org-2', name: 'Organization Two' }
            ]);
            await db
                .insert(m2mApplicationsOrganizationsTable)
                .values([{ m2mAppId: created.id, organizationId: 'org-1' }]);

            await repository.replaceOrganizations(created.id, ['org-2']);
        });

        it('clears the selected organizations for an m2m app', async ({ db }) => {
            const created = await repository.create({
                name: 'M2M With Organizations',
                description: null,
                roles: []
            });

            await db.insert(organizationsTable).values([{ id: 'org-1', name: 'Organization One' }]);
            await db
                .insert(m2mApplicationsOrganizationsTable)
                .values([{ m2mAppId: created.id, organizationId: 'org-1' }]);

            const organizations = await repository.replaceOrganizations(created.id, []);

            expect(organizations).toEqual([]);

            const links = await db.query.m2mApplicationsOrganizationsTable.findMany({
                where: (t, { eq }) => eq(t.m2mAppId, created.id)
            });
            expect(links).toEqual([]);
        });
    });

    describe('allWalletAddressesForApp', () => {
        const WALLET_A = '0x000000000000000000000000000000000000000A' as Address;
        const WALLET_B = '0x000000000000000000000000000000000000000b' as Address;

        it('returns wallet addresses across all linked organizations', async () => {
            const org1 = await orgsRepo.create({ name: 'Org 1', defaultRoles: [] });
            const org2 = await orgsRepo.create({ name: 'Org 2', defaultRoles: [] });

            const user1 = await usersRepo.createFromAdminApi({ displayName: 'User 1', wallets: [WALLET_A] });
            const user2 = await usersRepo.createFromAdminApi({ displayName: 'User 2', wallets: [WALLET_B] });
            await orgsRepo.addUser(org1.id, user1.id);
            await orgsRepo.addUser(org2.id, user2.id);

            const m2mApp = await repository.create({
                name: 'app',
                description: null,
                roles: [],
                organizationIds: [org1.id, org2.id]
            });

            const addresses = await repository.findAllWalletAddressesForApp(m2mApp.id);

            expect(addresses).toHaveLength(2);
            expect(addresses).toEqual(expect.arrayContaining([WALLET_A, WALLET_B]));
        });

        it('returns empty array when app has no linked organizations', async () => {
            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            const addresses = await repository.findAllWalletAddressesForApp(m2mApp.id);
            expect(addresses).toEqual([]);
        });

        it('returns empty array when linked organizations have no users', async () => {
            const org = await orgsRepo.create({ name: 'Empty Org', defaultRoles: [] });
            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            await repository.replaceOrganizations(m2mApp.id, [org.id]);

            const addresses = await repository.findAllWalletAddressesForApp(m2mApp.id);

            expect(addresses).toEqual([]);
        });

        it('excludes wallets from organizations not linked to the app', async () => {
            const linkedOrg = await orgsRepo.create({ name: 'Linked', defaultRoles: [] });
            const unlinkedOrg = await orgsRepo.create({ name: 'Unlinked', defaultRoles: [] });

            const user1 = await usersRepo.createFromAdminApi({ displayName: 'User 1', wallets: [WALLET_A] });
            const user2 = await usersRepo.createFromAdminApi({ displayName: 'User 2', wallets: [WALLET_B] });
            await orgsRepo.addUser(linkedOrg.id, user1.id);
            await orgsRepo.addUser(unlinkedOrg.id, user2.id);

            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            await repository.replaceOrganizations(m2mApp.id, [linkedOrg.id]);

            const addresses = await repository.findAllWalletAddressesForApp(m2mApp.id);

            expect(addresses).toEqual([WALLET_A]);
        });
    });

    describe('walletAddressesForAppAmong', () => {
        const WALLET_A = '0x000000000000000000000000000000000000000A' as Address;
        const WALLET_B = '0x000000000000000000000000000000000000000b' as Address;

        async function appWithMember(wallet: Address) {
            const org = await orgsRepo.create({ name: 'Linked Org', defaultRoles: [] });
            const user = await usersRepo.createFromAdminApi({ displayName: 'Member', wallets: [wallet] });
            await orgsRepo.addUser(org.id, user.id);
            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            await repository.replaceOrganizations(m2mApp.id, [org.id]);
            return { org, m2mApp };
        }

        it('returns only the candidates that belong to a linked organization', async () => {
            const { m2mApp } = await appWithMember(WALLET_A);
            expect(await repository.walletAddressesForAppAmong(m2mApp.id, [WALLET_A, WALLET_B])).toEqual([WALLET_A]);
        });

        it('returns nothing for an empty candidate list', async () => {
            const { m2mApp } = await appWithMember(WALLET_A);
            expect(await repository.walletAddressesForAppAmong(m2mApp.id, [])).toEqual([]);
        });

        it('stops returning member wallets once the organization is soft-deleted', async ({ db }) => {
            const { org, m2mApp } = await appWithMember(WALLET_A);
            expect(await repository.walletAddressesForAppAmong(m2mApp.id, [WALLET_A])).toEqual([WALLET_A]);

            await db.update(organizationsTable).set({ deletedAt: new Date() }).where(eq(organizationsTable.id, org.id));

            expect(await repository.walletAddressesForAppAmong(m2mApp.id, [WALLET_A])).toEqual([]);
        });
    });

    describe('findUserByAddressForApp', () => {
        const WALLET_A = '0x000000000000000000000000000000000000000A' as Address;
        const WALLET_B = '0x000000000000000000000000000000000000000b' as Address;

        it('finds a user by address within linked organizations', async () => {
            const org = await orgsRepo.create({ name: 'Org', defaultRoles: [] });
            const user = await usersRepo.createFromAdminApi({ displayName: 'User', wallets: [WALLET_A] });
            await orgsRepo.addUser(org.id, user.id);

            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            await repository.replaceOrganizations(m2mApp.id, [org.id]);

            const found = await repository.findUserByAddressForApp(m2mApp.id, WALLET_A);

            expect(found).toBeDefined();
            expect(found!.id).toBe(user.id);
            expect(found!.wallets).toEqual(
                expect.arrayContaining([expect.objectContaining({ walletAddress: WALLET_A })])
            );
        });

        it('returns undefined when address belongs to an unlinked organization', async () => {
            const linkedOrg = await orgsRepo.create({ name: 'Linked', defaultRoles: [] });
            const unlinkedOrg = await orgsRepo.create({ name: 'Unlinked', defaultRoles: [] });

            const user = await usersRepo.createFromAdminApi({ displayName: 'User', wallets: [WALLET_A] });
            await orgsRepo.addUser(unlinkedOrg.id, user.id);

            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            await repository.replaceOrganizations(m2mApp.id, [linkedOrg.id]);

            const found = await repository.findUserByAddressForApp(m2mApp.id, WALLET_A);

            expect(found).toBeUndefined();
        });

        it('returns undefined when address does not exist', async () => {
            const org = await orgsRepo.create({ name: 'Org', defaultRoles: [] });
            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });
            await repository.replaceOrganizations(m2mApp.id, [org.id]);

            const found = await repository.findUserByAddressForApp(m2mApp.id, WALLET_B);

            expect(found).toBeUndefined();
        });

        it('returns undefined when app has no linked organizations', async () => {
            const m2mApp = await repository.create({ name: 'app', description: null, roles: [] });

            const found = await repository.findUserByAddressForApp(m2mApp.id, WALLET_A);

            expect(found).toBeUndefined();
        });
    });

    describe('delete', () => {
        it('deletes an existing m2m app', async () => {
            const created = await repository.create({
                name: 'M2M App To Delete',
                description: null,
                roles: []
            });

            await repository.delete(created.id);

            await expect(repository.getById(created.id)).rejects.toThrow(EntityNotFound);
        });

        it('throws when deleting a missing m2m app', async () => {
            await expect(repository.delete('does-not-exist')).rejects.toThrow(EntityNotFound);
        });
    });
});
