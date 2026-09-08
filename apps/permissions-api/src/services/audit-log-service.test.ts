import { describe, test } from 'vitest';
import { AuditLogContext, type AuditLogsService, resolveActiveOrganizationId } from './audit-logs-service';

describe('AuditLogContext.setActiveUser', () => {
    test('sets activeUserId when context is anonymous (null)', ({ expect }) => {
        const service = {
            logSecurityEvent: async () => {}
        } as unknown as AuditLogsService;
        const context = new AuditLogContext(
            null,
            null,
            null,
            null,
            'test-trace',
            'test-req',
            'anonymous',
            null,
            { ipAddress: '127.0.0.1' },
            service
        );

        context.setActiveUser('user-123');

        expect(context.activeUserId).toBe('user-123');
    });

    test('throws when activeUserId is already set', ({ expect }) => {
        const service = {
            logSecurityEvent: async () => {}
        } as unknown as AuditLogsService;
        const context = new AuditLogContext(
            'existing-user',
            null,
            null,
            null,
            'test-trace',
            'test-req',
            'user',
            null,
            { ipAddress: '127.0.0.1' },
            service
        );

        expect(() => context.setActiveUser('user-123')).toThrowError('Non anonymous audit context should not change.');
    });

    test('throws on second call after setting user', ({ expect }) => {
        const service = {
            logSecurityEvent: async () => {}
        } as unknown as AuditLogsService;
        const context = new AuditLogContext(
            null,
            null,
            null,
            null,
            'test-trace',
            'test-req',
            'anonymous',
            null,
            { ipAddress: '127.0.0.1' },
            service
        );

        context.setActiveUser('user-123');

        expect(() => context.setActiveUser('user-456')).toThrowError('Non anonymous audit context should not change.');
    });

    test('sets activeOrganizationId when provided, so a login is tagged with the org', ({ expect }) => {
        const service = {
            logSecurityEvent: async () => {}
        } as unknown as AuditLogsService;
        const context = new AuditLogContext(
            null,
            null,
            null,
            null,
            'test-trace',
            'test-req',
            'anonymous',
            null,
            { ipAddress: '127.0.0.1' },
            service
        );

        context.setActiveUser('user-123', 'org-1');

        expect(context.activeUserId).toBe('user-123');
        expect(context.activeOrganizationId).toBe('org-1');
    });

    test('leaves activeOrganizationId unchanged when the org is omitted', ({ expect }) => {
        const service = {
            logSecurityEvent: async () => {}
        } as unknown as AuditLogsService;
        const context = new AuditLogContext(
            null,
            null,
            null,
            'org-preset',
            'test-trace',
            'test-req',
            'anonymous',
            null,
            { ipAddress: '127.0.0.1' },
            service
        );

        context.setActiveUser('user-123');

        expect(context.activeOrganizationId).toBe('org-preset');
    });
});

describe('resolveActiveOrganizationId', () => {
    const req = (url: string, id?: string) =>
        ({ params: id ? { id } : {}, routeOptions: { url } }) as unknown as Parameters<
            typeof resolveActiveOrganizationId
        >[0];

    test('uses the org-scoped route param, ignoring the user org', ({ expect }) => {
        expect(resolveActiveOrganizationId(req('/api/organizations/:id/roles', 'org-1'), 'org-9')).toBe('org-1');
    });

    test('falls back to the user org on a non-org-scoped route', ({ expect }) => {
        expect(resolveActiveOrganizationId(req('/api/wallet/transaction'), 'org-2')).toBe('org-2');
    });

    test('is zone (null) when neither the route nor the user carries an org', ({ expect }) => {
        expect(resolveActiveOrganizationId(req('/api/audit-logs'), null)).toBeNull();
    });
});
