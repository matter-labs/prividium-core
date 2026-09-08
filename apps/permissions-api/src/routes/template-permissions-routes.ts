import { AUDIT_ACTIONS } from '@repo/access-control';
import * as z from 'zod/v4';
import type { FastifyServer } from '../build-app';
import {
    fullTemplatePermissionSchema,
    newTemplatePermissionSchema,
    updateTemplatePermissionSchema
} from '../repositories/template-permissions-repository';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { hexSchema } from '../utils/schemas/hex-schema';
import { paginatedResult } from '../utils/schemas/pagination';

const withIdSchema = z.object({ id: z.coerce.number() });

const paginationSchema = z.object({
    ...PaginationQuerySchema({ limit: { max: 1000 } }).shape,
    templateId: z.coerce.number().int().optional(),
    methodSelector: hexSchema.optional(),
    roleId: z.string().optional()
});

type Deps = {
    multiOrgEnabled: boolean;
};

export function templatePermissionsRoutes(server: FastifyServer, { multiOrgEnabled }: Deps) {
    // organizationOnly dropped from every schema while MULTI_ORG_ENABLED is off
    const fullPermissionSchema = multiOrgEnabled
        ? fullTemplatePermissionSchema
        : fullTemplatePermissionSchema.omit({ organizationOnly: true });
    const newPermissionSchema = multiOrgEnabled
        ? newTemplatePermissionSchema
        : newTemplatePermissionSchema.omit({ organizationOnly: true });
    const updatePermissionSchema = multiOrgEnabled
        ? updateTemplatePermissionSchema
        : updateTemplatePermissionSchema.omit({ organizationOnly: true });

    server.get(
        '/',
        {
            schema: {
                description: 'List template permissions with pagination',
                tags: ['template-permissions'],
                querystring: paginationSchema,
                response: {
                    200: paginatedResult(fullPermissionSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { limit, offset, templateId, methodSelector, roleId } = request.query;

            return await request.repos.templatePermissions.findPaginated(
                { templateId, methodSelector, roleId },
                { limit, offset }
            );
        }
    );

    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.TEMPLATE_PERMISSION_CREATE },
            schema: {
                description: 'Create a new template permission',
                tags: ['template-permissions'],
                body: newPermissionSchema,
                response: {
                    201: fullPermissionSchema,
                    400: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const permission = await request.repos.templatePermissions.create({
                ...request.body,
                methodSelector: request.body.methodSelector as `0x${string}`
            });
            return reply.status(201).send(permission);
        }
    );

    server.get(
        '/:id',
        {
            schema: {
                description: 'Get a template permission by id',
                tags: ['template-permissions'],
                params: withIdSchema,
                response: {
                    200: fullPermissionSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            return reply.send(await request.repos.templatePermissions.getPermissionById(request.params.id));
        }
    );

    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.TEMPLATE_PERMISSION_UPDATE },
            schema: {
                description:
                    'Replace a template permission (full update). The method and template pointed by the permission cannot be changed.',
                tags: ['template-permissions'],
                params: withIdSchema,
                body: updatePermissionSchema,
                response: {
                    200: fullPermissionSchema,
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const updated = await request.repos.templatePermissions.update(request.params.id, {
                organizationOnly: false,
                ...request.body
            });
            return reply.send(updated);
        }
    );

    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.TEMPLATE_PERMISSION_DELETE },
            schema: {
                description: 'Delete a template permission',
                tags: ['template-permissions'],
                params: withIdSchema,
                response: {
                    204: z.void(),
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            await request.repos.templatePermissions.delete(request.params.id);
            return reply.status(204).send();
        }
    );
}
