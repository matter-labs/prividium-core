import { hasSystemPermission } from '@repo/access-control';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod/v4';
import { ForbiddenError, InternalServerError } from '../utils/error-types';

function extractId(params: unknown, paramName = 'id'): string {
    const parsed = z.object({ [paramName]: z.string() }).safeParse(params);
    if (!parsed.success) {
        throw new InternalServerError(`Missing org id in route: no "${paramName}" param`);
    }
    return parsed.data[paramName] as string;
}

/**
 * `requireOrgAdmin` for a surface whose organization id arrives under another
 * route parameter. The core's own routes all use `:id` and call the plain hook.
 */
export function requireOrgAdminOn(paramName: string) {
    return (req: FastifyRequest): Promise<void> => requireOrgAdminFor(req, paramName);
}

/**
 * Authorization hook for `/organizations/:id/...` routes. Authorizes the request when the current
 * user holds the operator system permission for the target organization or the entire zone. `admin_read` for `GET`
 * requests, `admin_write` for any mutating methods. Any other user is rejected with a 403 that never
 * confirms whether the organization or its sub-resources exist, so cross-org existence cannot leak.
 *
 * @param req - The incoming request; its `:id` route param identifies the target organization.
 * @returns Resolves when the user is authorized.
 * @throws {InternalServerError} When the route is missing the organization `id` param.
 * @throws {ForbiddenError} When the user lacks the required permission for the organization.
 */
export async function requireOrgAdmin(req: FastifyRequest): Promise<void> {
    return requireOrgAdminFor(req, 'id');
}

async function requireOrgAdminFor(req: FastifyRequest, paramName: string): Promise<void> {
    const user = req.auth.currentUser();
    const orgId = extractId(req.params, paramName);

    const operatorPermission = req.method === 'GET' ? 'admin_read' : 'admin_write';
    if (hasSystemPermission(user, operatorPermission, orgId)) {
        return;
    }

    throw new ForbiddenError();
}
