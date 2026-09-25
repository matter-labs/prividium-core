import { AUDIT_ACTIONS } from '@repo/access-control';
import { describe, expect, it } from 'vitest';
import type { AuditLogWithAudience } from '../repositories/audit-logs-repository';
import { organizationAuditSummary } from './organization-audit-service';

const event: AuditLogWithAudience = {
    id: 'event',
    activeUserId: 'user',
    activeOrganizationId: 'viewer',
    activeTenantId: 'tenant',
    activeServiceId: 'service',
    affectedOrganizationIds: ['viewer'],
    actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
    actionDetails: {},
    traceId: 'trace',
    requestId: 'request',
    actorType: 'user',
    authSubject: 'credential',
    ipAddress: '192.0.2.1',
    userAgent: 'agent',
    createdAt: '2026-09-17T00:00:00.000Z'
};

describe('organization audit summary', () => {
    it.each([null, ['viewer']])('redacts rows with audience %j', (affectedOrganizationIds) => {
        const summary = organizationAuditSummary({ ...event, affectedOrganizationIds }, 'viewer');
        expect(summary).toMatchObject({
            activeOrganizationId: 'viewer',
            activeTenantId: null,
            activeServiceId: null,
            authSubject: null,
            ipAddress: null,
            userAgent: null
        });
        expect(summary).not.toHaveProperty('affectedOrganizationIds');
    });

    it.each([
        { activeOrganizationId: 'viewer', expected: 'viewer' },
        { activeOrganizationId: 'peer', expected: null },
        { activeOrganizationId: null, expected: null }
    ])('scopes actor organization $activeOrganizationId', ({ activeOrganizationId, expected }) => {
        expect(organizationAuditSummary({ ...event, activeOrganizationId }, 'viewer').activeOrganizationId).toBe(
            expected
        );
        expect(organizationAuditSummary({ ...event, activeOrganizationId }, 'viewer').activeUserId).toBe(
            expected === null ? null : 'user'
        );
    });

    it.each([
        {
            name: 'full details',
            actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
            actionDetails: {
                resourceType: 'm2m-app',
                resourceId: 'app',
                operation: 'PUT',
                result: 'success',
                statusCode: 200,
                organizationLinkChanges: { viewer: 'added', peer: 'removed' },
                secret: 'private',
                oldRow: { id: 'peer' }
            },
            expected: {
                resourceType: 'm2m-app',
                resourceId: 'app',
                operation: 'PUT',
                result: 'success',
                statusCode: 200,
                organizationLinkChange: 'added'
            }
        },
        {
            name: 'invalid types',
            actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
            actionDetails: { resourceType: null, resourceId: 1, operation: [], result: false, statusCode: '200' },
            expected: {}
        },
        {
            name: 'unrelated action',
            actionType: AUDIT_ACTIONS.M2M_APP_UPDATE,
            actionDetails: { organizationLinkChanges: { viewer: 'added' } },
            expected: {}
        },
        {
            name: 'removed link',
            actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
            actionDetails: { organizationLinkChanges: { viewer: 'removed' } },
            expected: { organizationLinkChange: 'removed' }
        },
        {
            name: 'peer-only link',
            actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
            actionDetails: { organizationLinkChanges: { peer: 'added' } },
            expected: {}
        },
        {
            name: 'invalid change',
            actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
            actionDetails: { organizationLinkChanges: { viewer: 'changed' } },
            expected: {}
        },
        {
            name: 'null changes',
            actionType: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE,
            actionDetails: { organizationLinkChanges: null },
            expected: {}
        }
    ])('allowlists $name', ({ actionType, actionDetails, expected }) => {
        expect(organizationAuditSummary({ ...event, actionType, actionDetails }, 'viewer').actionDetails).toEqual(
            expected
        );
    });
});
