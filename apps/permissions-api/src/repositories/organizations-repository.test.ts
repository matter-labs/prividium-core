import { ORG_ADMIN_ROLE_NAME } from '@repo/access-control';
import { eq } from 'drizzle-orm';
import type { Address } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { m2mApplicationsOrganizationsTable, organizationsTable, userRolesTable } from '../db/schema';
import { EntityAlreadyExistsError, EntityNotFound } from '../utils/error-types';
import { M2mApplicationsRepository } from './m2m-applications-repository';
import { OrganizationsRepository } from './organizations-repository';
import { RolesRepository } from './roles-repository';
import { UsersRepository } from './users-repository';

describe('OrganizationsRepository', () => {
    let repository: OrganizationsRepository;
    let rolesRepo: RolesRepository;
    let usersRepo: UsersRepository;
    let m2mAppsRepo: M2mApplicationsRepository;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new OrganizationsRepository(db);
        rolesRepo = new RolesRepository(db);
        usersRepo = new UsersRepository(db);
        m2mAppsRepo = new M2mApplicationsRepository(db);
    });

    it('creates an organization and sets its own role as a default', async () => {
        const organization = await repository.create({
            name: 'Org One',
            defaultRoles: []
        });
        expect(organization.id).toHaveLength(21);
        expect(organization.name).toBe('Org One');

        const role = await rolesRepo.create(
            { roleName: 'org-member', systemPermissions: [] },
            { organizationId: organization.id }
        );
        const withDefault = await repository.update(organization.id, {
            name: organization.name,
            defaultRoles: [{ id: role.id }]
        });
        expect(withDefault.defaultRoles).toEqual([expect.objectContaining({ id: role.id })]);
    });

    describe('countNonDeleted', () => {
        it('counts only non-deleted organizations', async () => {
            expect(await repository.countNonDeleted()).toBe(0);

            const a = await repository.create({ name: 'Org A', defaultRoles: [] });
            await repository.create({ name: 'Org B', defaultRoles: [] });
            expect(await repository.countNonDeleted()).toBe(2);

            await repository.delete(a.id);
            expect(await repository.countNonDeleted()).toBe(1);
        });
    });

    describe('update', () => {
        it('updates the organization name while keeping existing roles', async () => {
            const organization = await repository.create({ name: 'Org One', defaultRoles: [] });
            const role = await rolesRepo.create(
                { roleName: 'org-member', systemPermissions: [] },
                { organizationId: organization.id }
            );
            await repository.update(organization.id, { name: 'Org One', defaultRoles: [{ id: role.id }] });

            const updated = await repository.update(organization.id, {
                name: 'Renamed Org',
                defaultRoles: [{ id: role.id }]
            });

            expect(updated.name).toBe('Renamed Org');
            expect(updated.defaultRoles).toEqual([expect.objectContaining({ id: role.id })]);
        });

        it('replaces organization default roles with different roles', async () => {
            const organization = await repository.create({ name: 'Org One', defaultRoles: [] });
            const firstRole = await rolesRepo.create(
                { roleName: 'org-member', systemPermissions: [] },
                { organizationId: organization.id }
            );
            const secondRole = await rolesRepo.create(
                { roleName: 'org-admin', systemPermissions: [] },
                { organizationId: organization.id }
            );
            await repository.update(organization.id, { name: organization.name, defaultRoles: [{ id: firstRole.id }] });

            const updated = await repository.update(organization.id, {
                name: organization.name,
                defaultRoles: [{ id: secondRole.id }]
            });

            expect(updated.defaultRoles).toEqual([expect.objectContaining({ id: secondRole.id })]);

            await expect(repository.getById(organization.id)).resolves.toEqual(
                expect.objectContaining({
                    defaultRoles: [expect.objectContaining({ id: secondRole.id })]
                })
            );
        });

        it('removes all default roles when updated with an empty role list', async () => {
            const organization = await repository.create({ name: 'Org One', defaultRoles: [] });
            const firstRole = await rolesRepo.create(
                { roleName: 'org-member', systemPermissions: [] },
                { organizationId: organization.id }
            );
            const secondRole = await rolesRepo.create(
                { roleName: 'org-admin', systemPermissions: [] },
                { organizationId: organization.id }
            );
            await repository.update(organization.id, {
                name: organization.name,
                defaultRoles: [{ id: firstRole.id }, { id: secondRole.id }]
            });

            const updated = await repository.update(organization.id, {
                name: organization.name,
                defaultRoles: []
            });

            expect(updated.defaultRoles).toEqual([]);
        });

        it('throws when updating an organization with roles that do not exist and rolls back previous changes', async () => {
            const organization = await repository.create({ name: 'Org One', defaultRoles: [] });
            const existingRole = await rolesRepo.create(
                { roleName: 'org-member', systemPermissions: [] },
                { organizationId: organization.id }
            );
            const otherRole = await rolesRepo.create(
                { roleName: 'org-admin', systemPermissions: [] },
                { organizationId: organization.id }
            );
            await repository.update(organization.id, {
                name: 'Org One',
                defaultRoles: [{ id: existingRole.id }]
            });

            await expect(
                repository.update(organization.id, {
                    name: 'Renamed Org',
                    defaultRoles: [{ id: otherRole.id }, { id: 'missing-role' }]
                })
            ).rejects.toThrow(new EntityNotFound('Role', { id: 'missing-role' }));

            await expect(repository.getById(organization.id)).resolves.toEqual(
                expect.objectContaining({
                    name: 'Org One',
                    defaultRoles: [expect.objectContaining({ id: existingRole.id })]
                })
            );
        });

        it('throws when updating a non-existent organization', async () => {
            await expect(
                repository.update('non-existent-org', {
                    name: 'Renamed Org',
                    defaultRoles: []
                })
            ).rejects.toThrow(new EntityNotFound('Organization', { id: 'non-existent-org' }));
        });
    });

    it('assigns and removes an existing user', async () => {
        const organization = await repository.create({
            name: 'Org One',
            defaultRoles: []
        });
        const user = await usersRepo.createFromAdminApi({
            displayName: 'Member User',
            roles: [],
            wallets: []
        });

        const assignedUser = await repository.addUser(organization.id, user.id);
        expect(assignedUser.organizationId).toBe(organization.id);
        expect(assignedUser.organization).toEqual({
            id: organization.id,
            name: organization.name,
            deletedAt: null
        });

        await repository.removeUser(organization.id, user.id);

        const reloadedUser = await usersRepo.findById(user.id);
        expect(reloadedUser?.organizationId).toBeNull();
    });

    it('member views report every role the member holds, including zone-level ones', async ({ db }) => {
        const organization = await repository.create({ name: 'Org Scoped Roles', defaultRoles: [] });
        const orgRole = await rolesRepo.create(
            { roleName: 'org-scoped-role', systemPermissions: [] },
            { organizationId: organization.id }
        );
        const zoneRole = await rolesRepo.create({ roleName: 'zone-level-role', systemPermissions: [] });

        const user = await usersRepo.createFromAdminApi({
            displayName: 'Multi-role Member',
            roles: [],
            wallets: []
        });
        const adminRole = await rolesRepo.orgAdminRole(organization.id);
        await repository.addUser(organization.id, user.id);
        await repository.setMemberRoles(organization.id, user.id, [orgRole.id, adminRole.id]);
        // A zone role reaches a member either from a zone-only deployment or from a legacy cross-scope
        // grant; hiding it would report the member as less privileged than they are.
        await db.insert(userRolesTable).values({ userId: user.id, roleId: zoneRole.id });

        const expectedRoleNames = [ORG_ADMIN_ROLE_NAME, orgRole.roleName, zoneRole.roleName].sort();

        const member = await repository.getMember(organization.id, user.id);
        expect(member.roles.map((r) => r.roleName).sort()).toEqual(expectedRoleNames);

        const listed = (await repository.usersFor(organization.id, { limit: 10, offset: 0 })).items.find(
            (m) => m.id === user.id
        );
        expect(listed?.roles.map((r) => r.roleName).sort()).toEqual(expectedRoleNames);

        const byZoneRole = await repository.usersFor(organization.id, { limit: 10, offset: 0, roleId: zoneRole.id });
        expect(byZoneRole.items.map((m) => m.id)).toEqual([user.id]);
    });

    it('drops the member org-owned roles on removal and does not restore them on re-add', async () => {
        const organization = await repository.create({ name: 'Org Roles', defaultRoles: [] });
        const orgRole = await rolesRepo.create(
            { roleName: 'org-member-role', systemPermissions: [] },
            { organizationId: organization.id }
        );
        const user = await usersRepo.createFromAdminApi({
            displayName: 'Member User',
            roles: [],
            wallets: []
        });
        await repository.addUser(organization.id, user.id);
        await repository.setMemberRoles(organization.id, user.id, [orgRole.id]);

        const member = await usersRepo.findById(user.id);
        expect(member?.roles.map((r) => r.roleName)).toContain(orgRole.roleName);

        await repository.removeUser(organization.id, user.id);

        const removed = await usersRepo.findById(user.id);
        expect(removed?.organizationId).toBeNull();
        expect(removed?.roles).toEqual([]);

        // Re-adding the member must not silently restore the org role they held before removal.
        await repository.addUser(organization.id, user.id);
        const readded = await usersRepo.findById(user.id);
        expect(readded?.roles).toEqual([]);
    });

    it('removes members including admins, dropping their org roles', async () => {
        const organization = await repository.create({ name: 'Org Admins', defaultRoles: [] });
        const adminA = await usersRepo.createFromAdminApi({ displayName: 'Admin A', roles: [], wallets: [] });
        const adminB = await usersRepo.createFromAdminApi({ displayName: 'Admin B', roles: [], wallets: [] });
        const adminRole = await rolesRepo.orgAdminRole(organization.id);
        await repository.addUser(organization.id, adminA.id);
        await repository.addUser(organization.id, adminB.id);
        await repository.setMemberRoles(organization.id, adminA.id, [adminRole.id]);
        await repository.setMemberRoles(organization.id, adminB.id, [adminRole.id]);

        await repository.removeUser(organization.id, adminA.id);
        const removedAdmin = await usersRepo.findById(adminA.id);
        expect(removedAdmin?.organizationId).toBeNull();
        expect(removedAdmin?.roles.map((r) => r.roleName)).not.toContain(ORG_ADMIN_ROLE_NAME);

        // The last admin can be removed too; a zone operator can restore org admins.
        await repository.removeUser(organization.id, adminB.id);
        expect((await usersRepo.findById(adminB.id))?.organizationId).toBeNull();
    });

    describe('setMemberRoles manages the org Admin system role', () => {
        it('assigns and removes the org Admin role alongside custom roles', async () => {
            const organization = await repository.create({ name: 'Org Set Roles', defaultRoles: [] });
            const adminRole = await rolesRepo.orgAdminRole(organization.id);
            const orgRole = await rolesRepo.create(
                { roleName: 'org-custom-role', systemPermissions: [] },
                { organizationId: organization.id }
            );
            const keeper = await usersRepo.createFromAdminApi({ displayName: 'Keeper', roles: [], wallets: [] });
            await repository.addUser(organization.id, keeper.id);
            await repository.setMemberRoles(organization.id, keeper.id, [adminRole.id]);
            const member = await usersRepo.createFromAdminApi({ displayName: 'Member', roles: [], wallets: [] });
            await repository.addUser(organization.id, member.id);

            const promoted = await repository.setMemberRoles(organization.id, member.id, [orgRole.id, adminRole.id]);
            expect(promoted.roles.map((r) => r.roleName).sort()).toEqual(
                [ORG_ADMIN_ROLE_NAME, orgRole.roleName].sort()
            );

            const demoted = await repository.setMemberRoles(organization.id, member.id, [orgRole.id]);
            expect(demoted.roles.map((r) => r.roleName)).toEqual([orgRole.roleName]);
        });

        it('removes the org Admin role even from the last admin', async () => {
            const organization = await repository.create({ name: 'Org Last Admin', defaultRoles: [] });
            const adminRole = await rolesRepo.orgAdminRole(organization.id);
            const member = await usersRepo.createFromAdminApi({ displayName: 'Only Admin', roles: [], wallets: [] });
            await repository.addUser(organization.id, member.id);
            await repository.setMemberRoles(organization.id, member.id, [adminRole.id]);

            const updated = await repository.setMemberRoles(organization.id, member.id, []);
            expect(updated.roles).toEqual([]);
        });
    });

    it('rejects assigning a user already in another organization', async () => {
        const first = await repository.create({
            name: 'First Org',
            defaultRoles: []
        });
        const second = await repository.create({
            name: 'Second Org',
            defaultRoles: []
        });
        const user = await usersRepo.createFromAdminApi({
            displayName: 'Member User',
            roles: [],
            wallets: []
        });

        await repository.addUser(first.id, user.id);

        await expect(repository.addUser(second.id, user.id)).rejects.toThrow(EntityAlreadyExistsError);
    });

    it('soft-deletes an organization, preserving the row, membership, and m2m links', async ({ db }) => {
        const organization = await repository.create({
            name: 'Org One',
            defaultRoles: []
        });
        const user = await usersRepo.createFromAdminApi({
            displayName: 'Member User',
            roles: [],
            wallets: []
        });
        const m2mApp = await m2mAppsRepo.create({
            name: 'm2m-app',
            description: null,
            roles: []
        });

        await repository.addUser(organization.id, user.id);
        await db.insert(m2mApplicationsOrganizationsTable).values({
            m2mAppId: m2mApp.id,
            organizationId: organization.id
        });

        await repository.delete(organization.id);

        // The row is kept with deletedAt set, not removed — so audit records referencing it stay intact.
        const row = await db.query.organizationsTable.findFirst({
            where: (t, { eq }) => eq(t.id, organization.id)
        });
        expect(row?.deletedAt).not.toBeNull();

        // ...but it is hidden from reads, so the API surfaces it as not found.
        await expect(repository.getById(organization.id)).rejects.toThrow(EntityNotFound);

        // Membership and m2m links are preserved (no destructive cascade).
        const reloadedUser = await db.query.usersTable.findFirst({
            where: (t, { eq }) => eq(t.id, user.id),
            columns: {
                organizationId: true
            }
        });
        expect(reloadedUser?.organizationId).toBe(organization.id);

        const links = await db.query.m2mApplicationsOrganizationsTable.findMany({
            where: (t, { eq }) => eq(t.m2mAppId, m2mApp.id)
        });
        expect(links).toHaveLength(1);
    });

    it('lists organization users with lightweight organization data', async () => {
        const organization = await repository.create({
            name: 'Org One',
            defaultRoles: []
        });
        const user = await usersRepo.createFromAdminApi({
            displayName: 'Member User',
            roles: [],
            wallets: []
        });
        await repository.addUser(organization.id, user.id);

        const result = await repository.usersFor(organization.id, { limit: 10, offset: 0 });

        expect(result.items).toEqual([
            expect.objectContaining({
                id: user.id,
                organizationId: organization.id,
                organization: {
                    id: organization.id,
                    name: organization.name,
                    deletedAt: null
                }
            })
        ]);
    });

    describe('walletBelongsToAnyOrg', () => {
        const memberWallet = '0x1111111111111111111111111111111111111111' as Address;
        const orphanWallet = '0x2222222222222222222222222222222222222222' as Address;
        const unknownWallet = '0x3333333333333333333333333333333333333333' as Address;

        // orgA has a member whose wallet is `memberWallet`; `orphanWallet` belongs to a user with no
        // organization; `unknownWallet` is not associated with any user.
        async function setup() {
            const orgA = await repository.create({ name: 'Org A', defaultRoles: [] });
            const orgB = await repository.create({ name: 'Org B', defaultRoles: [] });

            const member = await usersRepo.createFromAdminApi({
                displayName: 'Member',
                roles: [],
                wallets: [memberWallet]
            });
            await repository.addUser(orgA.id, member.id);

            await usersRepo.createFromAdminApi({
                displayName: 'Orphan',
                roles: [],
                wallets: [orphanWallet]
            });

            return { orgA, orgB };
        }

        it('returns true when the wallet belongs to a user in the given organization', async () => {
            const { orgA } = await setup();
            expect(await repository.walletBelongsToOrgList(memberWallet, [orgA.id])).toBe(true);
        });

        it('returns true when the wallet belongs to a user in any of several given organizations', async () => {
            const { orgA, orgB } = await setup();
            expect(await repository.walletBelongsToOrgList(memberWallet, [orgB.id, orgA.id])).toBe(true);
        });

        it('returns false when the wallet belongs to a user in a different organization', async () => {
            const { orgB } = await setup();
            expect(await repository.walletBelongsToOrgList(memberWallet, [orgB.id])).toBe(false);
        });

        it('returns false when the wallet belongs to a user with no organization', async () => {
            const { orgA } = await setup();
            expect(await repository.walletBelongsToOrgList(orphanWallet, [orgA.id])).toBe(false);
        });

        it('returns false for a wallet not associated with any user', async () => {
            const { orgA } = await setup();
            expect(await repository.walletBelongsToOrgList(unknownWallet, [orgA.id])).toBe(false);
        });

        it('returns false when the organization list is empty', async () => {
            await setup();
            expect(await repository.walletBelongsToOrgList(memberWallet, [])).toBe(false);
        });

        // Org-wide visibility resolves through these two, so a deleted org must stop granting it.
        it('stops resolving members once the organization is soft-deleted', async ({ db }) => {
            const { orgA } = await setup();
            expect(await repository.walletBelongsToOrgList(memberWallet, [orgA.id])).toBe(true);
            expect(await repository.userWalletsForOrgListAmong([orgA.id], [memberWallet])).toContain(memberWallet);

            await db
                .update(organizationsTable)
                .set({ deletedAt: new Date() })
                .where(eq(organizationsTable.id, orgA.id));

            expect(await repository.walletBelongsToOrgList(memberWallet, [orgA.id])).toBe(false);
            expect(await repository.userWalletsForOrgListAmong([orgA.id], [memberWallet])).toEqual([]);
        });
    });

    describe('userWalletsForOrgListAmong', () => {
        const memberWallet = '0x4444444444444444444444444444444444444444' as Address;
        const otherMemberWallet = '0x5555555555555555555555555555555555555555' as Address;
        const strangerWallet = '0x6666666666666666666666666666666666666666' as Address;

        async function setup() {
            const org = await repository.create({ name: 'Org With Members', defaultRoles: [] });
            for (const [displayName, wallet] of [
                ['Member', memberWallet],
                ['Other Member', otherMemberWallet]
            ] as const) {
                const member = await usersRepo.createFromAdminApi({ displayName, roles: [], wallets: [wallet] });
                await repository.addUser(org.id, member.id);
            }
            return org;
        }

        it('returns only the candidates that belong to the organizations', async () => {
            const org = await setup();
            expect(await repository.userWalletsForOrgListAmong([org.id], [memberWallet, strangerWallet])).toEqual([
                memberWallet
            ]);
        });

        it('never returns a member wallet that was not asked about', async () => {
            const org = await setup();
            const found = await repository.userWalletsForOrgListAmong([org.id], [memberWallet]);
            expect(found).not.toContain(otherMemberWallet);
        });

        it('returns nothing for an empty candidate or organization list', async () => {
            const org = await setup();
            expect(await repository.userWalletsForOrgListAmong([org.id], [])).toEqual([]);
            expect(await repository.userWalletsForOrgListAmong([], [memberWallet])).toEqual([]);
        });
    });
});
