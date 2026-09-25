import { AUDIT_ACTIONS } from '@repo/access-control';
import { eq } from 'drizzle-orm';
import { describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { auditLogsTable, organizationsTable } from '../db/schema';
import { AuditLogsService, fakeAuditLogContextForTests } from '../services/audit-logs-service';

describe('Audit event organization audience persistence', () => {
    it('caps organization counts across legacy and explicit audiences', async ({ db }) => {
        const repos = new Repositories(db);
        await db.insert(organizationsTable).values({ id: 'org', name: 'Organization' });
        for (let index = 0; index < 6; index++) {
            await repos.auditLogs.create({
                activeUserId: null,
                activeOrganizationId: index % 2 === 0 ? 'org' : null,
                affectedOrganizationIds: index % 2 === 0 ? undefined : ['org'],
                actionType: AUDIT_ACTIONS.M2M_APP_UPDATE,
                actionDetails: {}
            });
        }
        const page = await repos.auditLogs.findForOrganization('org', {}, { limit: 2, offset: 0 }, 3);
        expect(page.items).toHaveLength(2);
        expect(page.pagination).toMatchObject({ totalItems: 3, totalPages: 2 });
        const lastPage = await repos.auditLogs.findForOrganization('org', {}, { limit: 2, offset: 2 }, 3);
        expect(lastPage.items).toHaveLength(1);
        expect(lastPage.pagination).toEqual({ totalItems: 3, totalPages: 2, currentPage: 2, limit: 2, offset: 2 });
        expect(
            (await repos.auditLogs.findForOrganization('org', {}, { limit: 2, offset: 0 })).pagination.totalItems
        ).toBe(6);
    });

    it('preserves legacy, empty and deduplicated audiences without exposing internal metadata', async ({ db }) => {
        const repos = new Repositories(db);
        const service = new AuditLogsService(repos);
        const context = fakeAuditLogContextForTests(service);
        for (const audience of [undefined, [], ['org-a', 'org-b', 'org-a']]) {
            await context.logSecurityEvent(AUDIT_ACTIONS.M2M_APP_UPDATE, 'm2m-app', 'app', undefined, db, audience);
        }
        const rows = await db.select().from(auditLogsTable).orderBy(auditLogsTable.createdAt);
        expect(rows.map((row) => row.affectedOrganizationIds)).toEqual([null, [], ['org-a', 'org-b']]);
        expect(rows.every((row) => row.requestId === 'test-request-id' && row.traceId === 'test-trace-id')).toBe(true);
        const result = await repos.auditLogs.findPaginated({}, { limit: 10, offset: 0 });
        expect(result.items).toHaveLength(3);
        expect(result.items.every((row) => !('affectedOrganizationIds' in row))).toBe(true);
        const created = await repos.auditLogs.create({
            activeUserId: null,
            actionType: AUDIT_ACTIONS.M2M_APP_CREATE,
            actionDetails: {},
            affectedOrganizationIds: ['org-a']
        });
        expect(created).not.toHaveProperty('affectedOrganizationIds');
        expect(await db.select().from(auditLogsTable).where(eq(auditLogsTable.id, created.id))).toHaveLength(1);
    });
});
