import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import {
    CreateTenantBodySchema,
    PaginatedTenantsSchema,
    PaginatedTenantUsersSchema,
    TenantSchema
} from './schemas/tenants';

const paginatedResponseSchema = PaginatedTenantsSchema;

const byIdSchema = z.object({
    id: z.string()
});

export function tenantsRoutes(server: FastifyServer) {
    // create tenant
    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.TENANT_CREATE },
            schema: {
                description: 'Creates a new tenant',
                tags: ['tenants'],
                body: CreateTenantBodySchema,
                response: {
                    200: TenantSchema,
                    400: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const tenant = await req.repos.tenants.create(req.body);
            return reply.send(tenant);
        }
    );

    // Get tenant by id
    server.get(
        '/:id',
        {
            schema: {
                description: 'Get tenant by id',
                tags: ['tenants'],
                params: byIdSchema,
                response: {
                    200: TenantSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const tenant = await req.repos.tenants.getById(req.params.id);
            return reply.send(tenant);
        }
    );

    // Search tenants
    server.get(
        '/',
        {
            schema: {
                description: 'Search tenants with pagination',
                tags: ['tenants'],
                querystring: PaginationQuerySchema(),
                response: {
                    200: paginatedResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { limit, offset } = req.query;
            const tenants = await req.repos.tenants.searchPaginated({
                limit,
                offset
            });
            return reply.send(tenants);
        }
    );

    // Update tenant by id (replace all fields)
    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.TENANT_UPDATE },
            schema: {
                description: 'Update a tenant by id',
                params: byIdSchema,
                body: CreateTenantBodySchema,
                response: {
                    200: TenantSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const updated = await req.repos.tenants.update(req.params.id, req.body);
            return reply.send(updated);
        }
    );

    // Delete tenant by id
    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.TENANT_DELETE },
            schema: {
                description: 'Updates a tenant by id',
                tags: ['tenants'],
                params: byIdSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            await req.repos.tenants.delete(req.params.id);
            return reply.status(204).send();
        }
    );

    server.get(
        '/:id/users',
        {
            schema: {
                description: 'Get users for a tenant',
                tags: ['tenants', 'users'],
                params: byIdSchema,
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedTenantUsersSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const res = await req.repos.tenants.usersFor(req.params.id, req.query);
            return reply.send(res);
        }
    );
}
