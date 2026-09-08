import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../utils/error-types';
import { requireOrgAdmin } from './require-org-admin';

type Role = { systemPermissions?: string[]; organizationId: string | null };

function request(opts: {
    method: string;
    orgId?: string;
    organizationId?: string | null;
    roles: Role[];
}): FastifyRequest {
    const user = { id: 'caller', organizationId: opts.organizationId ?? null, roles: opts.roles };
    return {
        method: opts.method,
        params: { id: opts.orgId },
        auth: { currentUser: () => user }
    } as unknown as FastifyRequest;
}

const operator: Role[] = [{ systemPermissions: ['admin_read', 'admin_write'], organizationId: null }];
const readOnlyOperator: Role[] = [{ systemPermissions: ['admin_read'], organizationId: null }];
const orgAdmin: Role[] = [{ systemPermissions: ['admin_read', 'admin_write'], organizationId: 'org-1' }];
const readOnlyOrgAdmin: Role[] = [{ systemPermissions: ['admin_read'], organizationId: 'org-1' }];
const orgMember: Role[] = [{ systemPermissions: ['org_users_manage'], organizationId: 'org-1' }];

describe('requireOrgAdmin', () => {
    it('allows the operator on reads and writes via the support bypass', async () => {
        await expect(
            requireOrgAdmin(request({ method: 'GET', orgId: 'org-1', roles: operator }))
        ).resolves.toBeUndefined();
        await expect(
            requireOrgAdmin(request({ method: 'DELETE', orgId: 'org-1', roles: operator }))
        ).resolves.toBeUndefined();
    });

    it('allows a read-only operator to read but not mutate', async () => {
        await expect(
            requireOrgAdmin(request({ method: 'GET', orgId: 'org-1', roles: readOnlyOperator }))
        ).resolves.toBeUndefined();
        await expect(
            requireOrgAdmin(request({ method: 'POST', orgId: 'org-1', roles: readOnlyOperator }))
        ).rejects.toThrow(ForbiddenError);
    });

    it('allows an org admin to read and write within their own organization', async () => {
        await expect(
            requireOrgAdmin(request({ method: 'GET', orgId: 'org-1', organizationId: 'org-1', roles: orgAdmin }))
        ).resolves.toBeUndefined();
        await expect(
            requireOrgAdmin(request({ method: 'POST', orgId: 'org-1', organizationId: 'org-1', roles: orgAdmin }))
        ).resolves.toBeUndefined();
    });

    it('allows a read-only org admin to read but not mutate their own organization', async () => {
        await expect(
            requireOrgAdmin(
                request({ method: 'GET', orgId: 'org-1', organizationId: 'org-1', roles: readOnlyOrgAdmin })
            )
        ).resolves.toBeUndefined();
        await expect(
            requireOrgAdmin(
                request({ method: 'POST', orgId: 'org-1', organizationId: 'org-1', roles: readOnlyOrgAdmin })
            )
        ).rejects.toThrow(ForbiddenError);
    });

    it('denies an org admin reading or writing a peer organization', async () => {
        await expect(
            requireOrgAdmin(request({ method: 'GET', orgId: 'org-2', organizationId: 'org-1', roles: orgAdmin }))
        ).rejects.toThrow(ForbiddenError);
        await expect(
            requireOrgAdmin(request({ method: 'POST', orgId: 'org-2', organizationId: 'org-1', roles: orgAdmin }))
        ).rejects.toThrow(ForbiddenError);
    });

    it('denies a non-admin member of the same organization', async () => {
        await expect(
            requireOrgAdmin(request({ method: 'GET', orgId: 'org-1', organizationId: 'org-1', roles: orgMember }))
        ).rejects.toThrow(ForbiddenError);
    });
});
