import { AUDIT_ACTIONS } from '@repo/access-control';
import { expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { auditLogsTable, organizationsTable } from '../db/schema';
import { type AuditLogContextData, AuditLogsService } from './audit-logs-service';

it.for([
    { activeOrganizationId: 'actor-org', audience: undefined, expected: null },
    { activeOrganizationId: 'actor-org', audience: [], expected: ['actor-org'] },
    { activeOrganizationId: 'actor-org', audience: ['peer'], expected: ['peer', 'actor-org'] },
    { activeOrganizationId: 'actor-org', audience: ['actor-org', 'actor-org'], expected: ['actor-org'] },
    { activeOrganizationId: null, audience: [], expected: [] },
    { activeOrganizationId: null, audience: ['peer'], expected: ['peer'] }
])('preserves acting organization visibility for %j', async ({ activeOrganizationId, audience, expected }, { db }) => {
    await db.insert(organizationsTable).values({ id: 'actor-org', name: 'Actor' });
    const service = new AuditLogsService(new Repositories(db));
    const context: AuditLogContextData = {
        activeUserId: null,
        activeTenantId: null,
        activeServiceId: null,
        activeOrganizationId,
        traceId: 'trace',
        requestId: 'request',
        actorType: 'anonymous',
        authSubject: null,
        auditContext: {}
    };
    await service.logSecurityEvent(AUDIT_ACTIONS.M2M_APP_UPDATE, 'm2m-app', 'app', context, {}, undefined, audience);
    const rows = await db.select().from(auditLogsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.affectedOrganizationIds).toEqual(expected);
});
