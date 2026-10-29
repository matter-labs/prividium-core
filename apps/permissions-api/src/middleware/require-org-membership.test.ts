import { defineFeaturePermission } from '@repo/api-kit';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '#utils/error-types';
import { requireOrgPermissionForM2mCaller, requireZonePermissionForM2mCaller } from './require-org-membership';

const EXAMPLE_ACCESS = defineFeaturePermission('example_feature_access', {
    feature: 'example-feature',
    orgGrantable: true
});

function m2mRequest(roles: { systemPermissions: string[]; organizationId: string | null }[]): FastifyRequest {
    const app = { id: 'app', roles: roles.map((role, i) => ({ id: `role-${i}`, roleName: `role-${i}`, ...role })) };
    return {
        params: { id: 'org-1' },
        auth: { type: 'm2m_app', currentM2mApp: () => app }
    } as unknown as FastifyRequest;
}

describe('m2m permission guards with a feature permission', () => {
    it('admits a machine holding it in the organization', async () => {
        const request = m2mRequest([{ systemPermissions: [EXAMPLE_ACCESS.name], organizationId: 'org-1' }]);

        await expect(requireOrgPermissionForM2mCaller(EXAMPLE_ACCESS.name)(request)).resolves.toBeUndefined();
    });

    it('refuses a machine holding it only in another organization', async () => {
        const request = m2mRequest([{ systemPermissions: [EXAMPLE_ACCESS.name], organizationId: 'org-2' }]);

        await expect(requireOrgPermissionForM2mCaller(EXAMPLE_ACCESS.name)(request)).rejects.toThrow(
            new ForbiddenError('Missing permission: example_feature_access')
        );
    });

    it('requires it zone-wide on the zone surface', async () => {
        const orgScoped = m2mRequest([{ systemPermissions: [EXAMPLE_ACCESS.name], organizationId: 'org-1' }]);
        const zoneWide = m2mRequest([{ systemPermissions: [EXAMPLE_ACCESS.name], organizationId: null }]);

        await expect(requireZonePermissionForM2mCaller(EXAMPLE_ACCESS.name)(orgScoped)).rejects.toThrow(ForbiddenError);
        await expect(requireZonePermissionForM2mCaller(EXAMPLE_ACCESS.name)(zoneWide)).resolves.toBeUndefined();
    });
});
