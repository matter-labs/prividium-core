import { eq } from 'drizzle-orm';
import { describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { type DB, Repositories } from './index';
import {
    m2mApplicationsOrganizationsTable,
    m2mApplicationsTable,
    m2mAppRolesTable,
    organizationsDefaultRoles,
    organizationsTable,
    rolesTable
} from './schema';

async function mutations(db: DB, tableName: string, operation: 'INSERT' | 'UPDATE' | 'DELETE') {
    const { items } = await new Repositories(db).auditLogs.findMutationsPaginated(
        { tableName, operation },
        { limit: 50, offset: 0 }
    );
    return items;
}

describe('Access-control mutation audit', () => {
    it('captures M2M configuration and ownership through creation, update, and deletion', async ({ db }) => {
        const repos = new Repositories(db);
        const org = await repos.organizations.create({ name: 'Owner', defaultRoles: [] });
        const app = await repos.m2mApps.createForOrg(org.id, { name: 'Original', description: null, roles: [] });

        const inserts = await mutations(db, 'm2m_applications', 'INSERT');
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
            primaryKey: app.id,
            oldRow: null,
            newRow: { id: app.id, name: 'Original', description: null, owner_organization_id: org.id }
        });

        await repos.m2mApps.updateForOrg(org.id, app.id, { name: 'Updated', description: 'Changed', roles: [] });
        const updates = await mutations(db, 'm2m_applications', 'UPDATE');
        expect(updates).toHaveLength(1);
        expect(updates[0]).toMatchObject({
            primaryKey: app.id,
            oldRow: { name: 'Original', description: null, owner_organization_id: org.id },
            newRow: { name: 'Updated', description: 'Changed', owner_organization_id: org.id },
            changedColumns: expect.arrayContaining(['name', 'description'])
        });

        await repos.m2mApps.deleteForOrg(org.id, app.id);
        const deletes = await mutations(db, 'm2m_applications', 'DELETE');
        expect(deletes).toHaveLength(1);
        expect(deletes[0]).toMatchObject({
            primaryKey: app.id,
            oldRow: { id: app.id, name: 'Updated', owner_organization_id: org.id },
            newRow: null
        });
    });

    it('captures M2M role replacement and clearing with composite keys', async ({ db }) => {
        const repos = new Repositories(db);
        const first = await repos.roles.create({ roleName: 'First', systemPermissions: [] });
        const second = await repos.roles.create({ roleName: 'Second', systemPermissions: [] });
        const app = await repos.m2mApps.create({ name: 'App', description: null, roles: [first] });

        await repos.m2mApps.update(app.id, { name: 'App', description: null, roles: [second] });
        await repos.m2mApps.update(app.id, { name: 'App', description: null, roles: [] });

        for (const operation of ['INSERT', 'DELETE'] as const) {
            const rows = await mutations(db, 'm2m_app_roles', operation);
            expect(rows).toHaveLength(2);
            for (const role of [first, second]) {
                const key = { m2m_app_id: app.id, role_id: role.id };
                const row = rows.find((entry) => JSON.parse(entry.primaryKey!).role_id === role.id);
                expect(row).toBeDefined();
                expect(JSON.parse(row!.primaryKey!)).toEqual(key);
                expect(row).toMatchObject(
                    operation === 'INSERT' ? { oldRow: null, newRow: key } : { oldRow: key, newRow: null }
                );
            }
        }
    });

    it('captures organization-link replacement and clearing with composite keys', async ({ db }) => {
        const repos = new Repositories(db);
        const first = await repos.organizations.create({ name: 'First', defaultRoles: [] });
        const second = await repos.organizations.create({ name: 'Second', defaultRoles: [] });
        const app = await repos.m2mApps.create({
            name: 'App',
            description: null,
            roles: [],
            organizationIds: [first.id]
        });

        await repos.m2mApps.replaceOrganizations(app.id, [second.id]);
        await repos.m2mApps.replaceOrganizations(app.id, []);

        for (const operation of ['INSERT', 'DELETE'] as const) {
            const rows = await mutations(db, 'm2m_applications_organizations', operation);
            expect(rows).toHaveLength(2);
            for (const org of [first, second]) {
                const key = { m2m_app_id: app.id, organization_id: org.id };
                const row = rows.find((entry) => JSON.parse(entry.primaryKey!).organization_id === org.id);
                expect(row).toBeDefined();
                expect(JSON.parse(row!.primaryKey!)).toEqual(key);
                expect(row).toMatchObject(
                    operation === 'INSERT' ? { oldRow: null, newRow: key } : { oldRow: key, newRow: null }
                );
            }
        }
    });

    it('captures organization default-role replacement and clearing with composite keys', async ({ db }) => {
        const repos = new Repositories(db);
        const first = await repos.roles.create({ roleName: 'First', systemPermissions: [] });
        const second = await repos.roles.create({ roleName: 'Second', systemPermissions: [] });
        const org = await repos.organizations.create({ name: 'Org', defaultRoles: [first] }, { allowZoneRoles: true });

        await repos.organizations.update(org.id, { name: 'Org', defaultRoles: [second] }, { allowZoneRoles: true });
        await repos.organizations.update(org.id, { name: 'Org', defaultRoles: [] });

        for (const operation of ['INSERT', 'DELETE'] as const) {
            const rows = await mutations(db, 'organizations_default_roles', operation);
            expect(rows).toHaveLength(2);
            for (const role of [first, second]) {
                const key = { organization_id: org.id, role_id: role.id };
                const row = rows.find((entry) => JSON.parse(entry.primaryKey!).role_id === role.id);
                expect(row).toBeDefined();
                expect(JSON.parse(row!.primaryKey!)).toEqual(key);
                expect(row).toMatchObject(
                    operation === 'INSERT' ? { oldRow: null, newRow: key } : { oldRow: key, newRow: null }
                );
            }
        }
    });

    it('captures relationship deletions cascaded from an M2M application', async ({ db }) => {
        const repos = new Repositories(db);
        const role = await repos.roles.create({ roleName: 'Role', systemPermissions: [] });
        const org = await repos.organizations.create({ name: 'Org', defaultRoles: [] });
        const app = await repos.m2mApps.create({
            name: 'App',
            description: null,
            roles: [role],
            organizationIds: [org.id]
        });

        await repos.m2mApps.delete(app.id);

        const roles = await mutations(db, 'm2m_app_roles', 'DELETE');
        const links = await mutations(db, 'm2m_applications_organizations', 'DELETE');
        expect(roles).toHaveLength(1);
        expect(roles[0]).toMatchObject({ oldRow: { m2m_app_id: app.id, role_id: role.id }, newRow: null });
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ oldRow: { m2m_app_id: app.id, organization_id: org.id }, newRow: null });
    });

    it('captures M2M and default-role deletions cascaded from a role', async ({ db }) => {
        const repos = new Repositories(db);
        const role = await repos.roles.create({ roleName: 'Role', systemPermissions: [] });
        const org = await repos.organizations.create({ name: 'Org', defaultRoles: [role] }, { allowZoneRoles: true });
        const app = await repos.m2mApps.create({ name: 'App', description: null, roles: [role] });

        await db.delete(rolesTable).where(eq(rolesTable.id, role.id));

        const roles = await mutations(db, 'm2m_app_roles', 'DELETE');
        const defaults = await mutations(db, 'organizations_default_roles', 'DELETE');
        expect(roles).toHaveLength(1);
        expect(roles[0]).toMatchObject({ oldRow: { m2m_app_id: app.id, role_id: role.id }, newRow: null });
        expect(defaults).toHaveLength(1);
        expect(defaults[0]).toMatchObject({ oldRow: { organization_id: org.id, role_id: role.id }, newRow: null });
    });

    it('rolls back mutation evidence with the access-control transaction', async ({ db }) => {
        const repos = new Repositories(db);
        const role = await repos.roles.create({ roleName: 'Role', systemPermissions: [] });
        const rollback = new Error('Roll back access changes');

        await expect(
            db.transaction(async (tx) => {
                const [org] = await tx.insert(organizationsTable).values({ name: 'Org' }).returning();
                const [app] = await tx.insert(m2mApplicationsTable).values({ name: 'App' }).returning();
                await tx.insert(organizationsDefaultRoles).values({ organizationId: org!.id, roleId: role.id });
                await tx.insert(m2mAppRolesTable).values({ m2mAppId: app!.id, roleId: role.id });
                await tx
                    .insert(m2mApplicationsOrganizationsTable)
                    .values({ m2mAppId: app!.id, organizationId: org!.id });
                throw rollback;
            })
        ).rejects.toThrow(rollback);

        for (const table of [
            'm2m_applications',
            'm2m_app_roles',
            'm2m_applications_organizations',
            'organizations_default_roles'
        ]) {
            expect(await mutations(db, table, 'INSERT')).toEqual([]);
        }
        expect(await db.select().from(m2mApplicationsTable)).toEqual([]);
    });
});
