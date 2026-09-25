import { AUDIT_ACTIONS } from '@repo/access-control';
import type { AuditLogWithAudience } from '../repositories/audit-logs-repository';

export function organizationAuditSummary(log: AuditLogWithAudience, organizationId: string) {
    const { affectedOrganizationIds: _audience, ...event } = log;

    const actionDetails: Record<string, unknown> = {};
    for (const key of ['resourceType', 'resourceId', 'operation', 'result'] as const) {
        const value = event.actionDetails[key];
        if (typeof value === 'string') actionDetails[key] = value;
    }
    if (typeof event.actionDetails.statusCode === 'number') {
        actionDetails.statusCode = event.actionDetails.statusCode;
    }
    const changes = event.actionDetails.organizationLinkChanges;
    if (
        event.actionType === AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE &&
        typeof changes === 'object' &&
        changes !== null
    ) {
        const change = (changes as Record<string, unknown>)[organizationId];
        if (change === 'added' || change === 'removed') actionDetails.organizationLinkChange = change;
    }

    return {
        ...event,
        activeOrganizationId: event.activeOrganizationId === organizationId ? organizationId : null,
        activeUserId: event.activeOrganizationId === organizationId ? event.activeUserId : null,
        activeTenantId: null,
        activeServiceId: null,
        authSubject: null,
        ipAddress: null,
        userAgent: null,
        actionDetails
    };
}
