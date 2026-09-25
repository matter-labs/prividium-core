import { sql } from 'drizzle-orm';
import { describe, expect, vi } from 'vitest';
import { it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { EntityNotFound } from '../utils/error-types';
import {
    createAuditedM2mApplication,
    deleteAuditedM2mApplication,
    replaceAuditedM2mOrganizations,
    updateAuditedM2mApplication
} from './m2m-audit-service';

describe('M2M audit organization attribution', () => {
    it('excludes soft-deleted links from updates, removals and deletion audiences', async ({ db }) => {
        const repos = new Repositories(db);
        const live = await repos.organizations.create({ name: 'Live', defaultRoles: [] });
        const deleted = await repos.organizations.create({ name: 'Deleted', defaultRoles: [] });
        const data = { name: 'Shared', roles: [], organizationIds: [live.id, deleted.id] };
        const { app } = await createAuditedM2mApplication(repos, data);
        const other = await createAuditedM2mApplication(repos, data);
        await repos.organizations.delete(deleted.id);

        const updated = await updateAuditedM2mApplication(repos, { appId: app.id }, data);
        expect(updated.auditEventDetails.affectedOrganizationIds).toEqual([live.id]);
        const cleared = await replaceAuditedM2mOrganizations(repos, app.id, []);
        expect(cleared.auditEventDetails.affectedOrganizationIds).toEqual([live.id]);
        expect(cleared.auditEventDetails.actionDetails).toEqual({ organizationLinkChanges: { [live.id]: 'removed' } });
        expect((await deleteAuditedM2mApplication(repos, { appId: other.app.id })).affectedOrganizationIds).toEqual([
            live.id
        ]);
    });

    it('captures linked audiences for creation, configuration/roles and deletion', async ({ db }) => {
        const repos = new Repositories(db);
        const a = await repos.organizations.create({ name: 'A', defaultRoles: [] });
        const b = await repos.organizations.create({ name: 'B', defaultRoles: [] });
        const role = await repos.roles.create({ roleName: 'Role', systemPermissions: [] });
        const created = await createAuditedM2mApplication(repos, {
            name: 'Shared',
            description: null,
            roles: [],
            organizationIds: [a.id, b.id]
        });
        expect(created.auditEventDetails.affectedOrganizationIds.sort()).toEqual([a.id, b.id].sort());
        const target = { appId: created.app.id };
        const updated = await updateAuditedM2mApplication(repos, target, {
            name: 'Changed',
            description: null,
            roles: [role]
        });
        expect(updated.app.roles.map((r) => r.id)).toEqual([role.id]);
        expect(updated.auditEventDetails.affectedOrganizationIds.sort()).toEqual([a.id, b.id].sort());
        const cleared = await updateAuditedM2mApplication(repos, target, {
            name: 'Changed',
            description: null,
            roles: []
        });
        expect(cleared.app.roles).toEqual([]);
        const deleted = await deleteAuditedM2mApplication(repos, target);
        expect(deleted.affectedOrganizationIds.sort()).toEqual([a.id, b.id].sort());
        await expect(repos.m2mApps.getById(target.appId)).rejects.toThrow(EntityNotFound);
    });

    it('includes changed peer links alongside the credential owner', async ({ db }) => {
        const repos = new Repositories(db);
        const owner = await repos.organizations.create({ name: 'Owner', defaultRoles: [] });
        const peer = await repos.organizations.create({ name: 'Peer', defaultRoles: [] });
        const body = { name: 'Owned', description: null, roles: [] };
        const created = await createAuditedM2mApplication(repos, body, owner.id);
        expect(created.auditEventDetails.affectedOrganizationIds).toEqual([owner.id]);
        const target = { appId: created.app.id, organizationId: owner.id };
        const links = await replaceAuditedM2mOrganizations(repos, target.appId, [peer.id]);
        expect(links.auditEventDetails.affectedOrganizationIds.sort()).toEqual([owner.id, peer.id].sort());
        expect(links.auditEventDetails.actionDetails).toEqual({ organizationLinkChanges: { [peer.id]: 'added' } });
        const unchanged = await replaceAuditedM2mOrganizations(repos, target.appId, [peer.id]);
        expect(unchanged.auditEventDetails.affectedOrganizationIds).toEqual([owner.id]);
        expect(unchanged.auditEventDetails.actionDetails).toEqual({ organizationLinkChanges: {} });
        const removed = await replaceAuditedM2mOrganizations(repos, target.appId, []);
        expect(removed.auditEventDetails.affectedOrganizationIds.sort()).toEqual([owner.id, peer.id].sort());
        expect(removed.auditEventDetails.actionDetails).toEqual({ organizationLinkChanges: { [peer.id]: 'removed' } });
        const updated = await updateAuditedM2mApplication(repos, target, body);
        expect(updated.auditEventDetails.affectedOrganizationIds).toEqual([owner.id]);
        await expect(updateAuditedM2mApplication(repos, { ...target, organizationId: peer.id }, body)).rejects.toThrow(
            EntityNotFound
        );
        const deleted = await deleteAuditedM2mApplication(repos, target);
        expect(deleted.affectedOrganizationIds).toEqual([owner.id]);
    });

    it('attributes only changed links, including clearing and idempotent replacements', async ({ db }) => {
        const repos = new Repositories(db);
        const a = await repos.organizations.create({ name: 'A', defaultRoles: [] });
        const b = await repos.organizations.create({ name: 'B', defaultRoles: [] });
        const c = await repos.organizations.create({ name: 'C', defaultRoles: [] });
        const { app } = await createAuditedM2mApplication(repos, {
            name: 'Shared',
            roles: [],
            organizationIds: [a.id, b.id]
        });
        const changed = await replaceAuditedM2mOrganizations(repos, app.id, [b.id, c.id, c.id]);
        expect(changed.auditEventDetails).toMatchObject({
            affectedOrganizationIds: expect.arrayContaining([a.id, c.id]),
            actionDetails: { organizationLinkChanges: { [a.id]: 'removed', [c.id]: 'added' } }
        });
        expect(changed.auditEventDetails.affectedOrganizationIds).toHaveLength(2);
        const unchanged = await replaceAuditedM2mOrganizations(repos, app.id, [b.id, c.id]);
        expect(unchanged.auditEventDetails.affectedOrganizationIds).toEqual([]);
        const cleared = await replaceAuditedM2mOrganizations(repos, app.id, []);
        expect(cleared.auditEventDetails).toMatchObject({
            actionDetails: { organizationLinkChanges: { [b.id]: 'removed', [c.id]: 'removed' } }
        });
    });

    it('returns no audience and rolls back link mutations when replacement fails', async ({ db }) => {
        const repos = new Repositories(db);
        const org = await repos.organizations.create({ name: 'Org', defaultRoles: [] });
        const { app } = await createAuditedM2mApplication(repos, {
            name: 'Shared',
            roles: [],
            organizationIds: [org.id]
        });
        const before = await repos.auditLogs.findMutationsPaginated(
            { tableName: 'm2m_applications_organizations' },
            { limit: 100, offset: 0 }
        );
        await expect(replaceAuditedM2mOrganizations(repos, app.id, ['missing-org'])).rejects.toThrow(EntityNotFound);
        expect((await repos.m2mApps.getById(app.id)).organizations).toEqual([{ id: org.id }]);
        const after = await repos.auditLogs.findMutationsPaginated(
            { tableName: 'm2m_applications_organizations' },
            { limit: 100, offset: 0 }
        );
        expect(after.items).toEqual(before.items);
    });

    it('waits for a concurrent link write before selecting its removal audience', async ({ db }) => {
        const repos = new Repositories(db);
        const a = await repos.organizations.create({ name: 'A', defaultRoles: [] });
        const b = await repos.organizations.create({ name: 'B', defaultRoles: [] });
        const { app } = await createAuditedM2mApplication(repos, {
            name: 'Shared',
            roles: [],
            organizationIds: [a.id]
        });
        let deletion: ReturnType<typeof deleteAuditedM2mApplication> | undefined;
        try {
            await repos.transaction(async (tx) => {
                const apps = tx.repositories().m2mApps;
                await apps.lockById(app.id);
                await apps.replaceOrganizations(app.id, [b.id]);
                // The fixture pool has two connections; this transaction and deletion hold both.
                deletion = deleteAuditedM2mApplication(repos, { appId: app.id });
                await vi.waitFor(
                    async () => {
                        await tx.execute(sql`SELECT pg_stat_clear_snapshot()`);
                        const result = await tx.execute(sql`
                        SELECT count(*)::int AS blocked FROM pg_stat_activity
                        WHERE pid <> pg_backend_pid() AND pg_blocking_pids(pid) @> ARRAY[pg_backend_pid()]
                    `);
                        expect(result.rows[0]?.blocked).toBeGreaterThan(0);
                    },
                    { timeout: 10_000, interval: 50 }
                );
            });
            expect((await deletion)?.affectedOrganizationIds).toEqual([b.id]);
        } finally {
            await deletion?.catch(() => {});
        }
    });
});
