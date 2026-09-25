import { describe, expect, it } from 'vitest';
import { auditPaginationQuerySchema, OrganizationAuditLogSchema } from './audit-logs';

describe('audit pagination', () => {
    it.each([
        { limit: 30, offset: 9990 },
        { limit: 1000, offset: 9999 },
        { limit: 30, offset: 30 }
    ])('preserves the requested page size at offset $offset', ({ limit, offset }) => {
        expect(auditPaginationQuerySchema(10_000).parse({ limit, offset })).toEqual({
            limit,
            offset
        });
    });

    it('keeps the default page within a small configured cap', () => {
        expect(auditPaginationQuerySchema(3).parse({})).toEqual({ limit: 3, offset: 0 });
    });

    it('rejects offsets at the cap', () => {
        expect(auditPaginationQuerySchema(10_000).safeParse({ limit: 1, offset: 10_000 }).success).toBe(false);
    });
});

describe('organization audit response boundary', () => {
    it.each([
        'activeTenantId',
        'activeServiceId',
        'authSubject',
        'ipAddress',
        'userAgent'
    ] as const)('rejects a non-null %s', (field) => {
        expect(OrganizationAuditLogSchema.shape[field].safeParse('private').success).toBe(false);
        expect(OrganizationAuditLogSchema.shape[field].safeParse(null).success).toBe(true);
    });

    it('strips unknown details even without handler redaction', () => {
        expect(
            OrganizationAuditLogSchema.shape.actionDetails.parse({
                resourceId: 'app',
                statusCode: 200,
                organizationLinkChange: 'added',
                organizationLinkChanges: { peer: 'removed' },
                secret: 'private'
            })
        ).toEqual({ resourceId: 'app', statusCode: 200, organizationLinkChange: 'added' });
    });
});
