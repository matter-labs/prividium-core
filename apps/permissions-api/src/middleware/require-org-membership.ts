import { hasSystemPermission, type Permission } from '@repo/access-control';
import { ForbiddenError } from '@repo/api-kit';
import type { FastifyRequest } from 'fastify';
import { requireOrgAdmin } from './require-org-admin';

export async function requireOrgAdminForUserCaller(req: FastifyRequest): Promise<void> {
    if (req.auth.type === 'user') {
        await requireOrgAdmin(req);
    }
}

export async function requireM2mAppOrgAssociation(req: FastifyRequest): Promise<void> {
    if (req.auth.type === 'm2m_app') {
        const m2mApp = req.auth.currentM2mApp();
        const orgId = (req.params as { id: string }).id;
        const orgs = await req.repos.m2mApps.getOrganizations(m2mApp.id);
        if (!orgs.some((o) => o.id === orgId)) {
            throw new ForbiddenError('M2M app is not associated with this organization');
        }
    }
}

/** Association alone is not enough: an integration linked for RPC reads would
 * otherwise inherit every other machine capability. */
export function requireOrgPermissionForM2mCaller(permission: Permission) {
    return async function requirePermission(req: FastifyRequest): Promise<void> {
        if (req.auth.type !== 'm2m_app') {
            return;
        }

        const orgId = (req.params as { id: string }).id;
        if (!hasSystemPermission(req.auth.currentM2mApp(), permission, orgId)) {
            throw new ForbiddenError(`Missing permission: ${permission}`);
        }
    };
}

export async function requireOrgMemberForUserCaller(req: FastifyRequest): Promise<void> {
    if (req.auth.type !== 'user') {
        return;
    }

    const user = req.auth.currentUser();
    const orgId = (req.params as { id: string }).id;
    if (user.organizationId === orgId) {
        return;
    }

    await requireOrgAdmin(req);
}
