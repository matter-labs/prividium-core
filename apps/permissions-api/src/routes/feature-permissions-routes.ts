import { z } from 'zod/v4';
import type { FastifyServer } from '#build-app';
import { requireOrgAdmin } from '#middleware/require-org-admin';
import type { SessionsAuthValidator } from '#middleware/sessions-auth';
import type { PermissionCatalog } from '#permissions/permission-catalog';
import { ErrorResponseSchema } from '#utils/schemas/fastify-common';
import { type FeaturePermissionListing, FeaturePermissionsListSchema } from './schemas/feature-permissions';

type Deps = {
    permissionCatalog: PermissionCatalog;
    /** The features this deployment registered, as `GET /info` lists them. */
    featureNames: readonly string[];
};

function listFeaturePermissions({ permissionCatalog, featureNames }: Deps): FeaturePermissionListing[] {
    const enabled = new Set(featureNames);
    return permissionCatalog.featurePermissions.map(({ name, feature, orgGrantable }) => ({
        name,
        feature,
        orgGrantable,
        enabled: enabled.has(feature)
    }));
}

/** Zone listing; the enclosing admin block gates it. */
export function featurePermissionsRoutes(server: FastifyServer, deps: Deps) {
    const items = listFeaturePermissions(deps);
    server.get(
        '/',
        {
            schema: {
                description:
                    'List the permissions the features in this build declare, and whether each feature is enabled',
                tags: ['roles'],
                response: {
                    200: FeaturePermissionsListSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (_req, reply) => reply.send({ items })
    );
}

/** An organization's admins see only what they may grant on its roles. */
export function orgFeaturePermissionsRoutes(
    server: FastifyServer,
    deps: Deps & { sessionAuthValidator: SessionsAuthValidator }
) {
    const items = listFeaturePermissions(deps).filter((permission) => permission.orgGrantable);
    server.addHook('onRequest', deps.sessionAuthValidator.buildHook({ targets: [{ type: 'user' }] }));
    server.addHook('preHandler', requireOrgAdmin);
    server.get(
        '/:id/feature-permissions',
        {
            schema: {
                description: 'List the feature permissions an organization admin may grant on its roles',
                tags: ['organizations', 'roles'],
                params: z.object({ id: z.string() }),
                response: {
                    200: FeaturePermissionsListSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            await req.repos.organizations.getById(req.params.id);
            return reply.send({ items });
        }
    );
}
