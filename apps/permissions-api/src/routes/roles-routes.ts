import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema, PaginationQuerySchema, SearchQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import { CreateRoleBodySchema as CreateRoleBodySchemaBase, RoleSchema, RoleWithCountsSchema } from './schemas/roles';

const roleIdParamSchema = z.object({
    id: z.string().min(1, 'Role id is required')
});

const paginatedResponseSchema = paginatedResult(RoleWithCountsSchema);

const listRolesQuerySchema = PaginationQuerySchema().extend({
    searchQuery: SearchQuerySchema.optional()
});

type Deps = {
    multiOrgEnabled: boolean;
};

export function rolesRoutes(server: FastifyServer, deps: Deps) {
    const CreateRoleBodySchema = deps.multiOrgEnabled
        ? CreateRoleBodySchemaBase
        : CreateRoleBodySchemaBase.omit({
              organizationId: true
          });

    // List roles with pagination
    server.get(
        '/',
        {
            schema: {
                description: 'List roles with pagination',
                tags: ['roles'],
                querystring: listRolesQuerySchema,
                response: {
                    200: paginatedResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            return await request.repos.roles.findPaginated(request.query);
        }
    );

    // Create role
    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.ROLE_CREATE },
            schema: {
                description: 'Create a new role (the unit of role-based access control / RBAC)',
                tags: ['roles'],
                body: CreateRoleBodySchema,
                response: {
                    201: RoleSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const role = await request.repos.roles.create(request.body);
            return reply.status(201).send(role);
        }
    );

    // Get a single role
    server.get(
        '/:id',
        {
            schema: {
                description: 'Get a role by id',
                tags: ['roles'],
                params: roleIdParamSchema,
                response: {
                    200: RoleSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { id } = request.params;
            return await request.repos.roles.getById(id);
        }
    );

    // Replace role (full update)
    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.ROLE_UPDATE },
            schema: {
                description: 'Replace a role (full update)',
                tags: ['roles'],
                params: roleIdParamSchema,
                body: CreateRoleBodySchema,
                response: {
                    200: RoleSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { id } = request.params;
            return await request.repos.roles.updateById(id, request.body);
        }
    );

    // Delete role
    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.ROLE_DELETE },
            schema: {
                description: 'Delete a role',
                tags: ['roles'],
                params: roleIdParamSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { id } = request.params;
            await request.repos.roles.deleteById(id);
            return reply.status(204).send();
        }
    );
}
