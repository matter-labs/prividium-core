import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema, PaginationQuerySchema, PublicIdSchema } from '../utils/schemas/fastify-common';
import {
    CreateM2mApplicationBodySchema,
    M2mApplicationSchema,
    PaginatedM2mApplicationsSchema,
    UpdateM2mApplicationBodySchema
} from './schemas/m2m-applications';
import { OrganizationSummarySchema } from './schemas/organizations';

const byIdSchema = z.strictObject({
    id: PublicIdSchema
});

const replaceOrganizationsBodySchema = z.object({
    organizationIds: z.array(z.string())
});

export function m2mAppRoutes(server: FastifyServer) {
    server.post(
        '/',
        {
            schema: {
                description: 'Create a new m2m application',
                tags: ['m2m-applications'],
                body: CreateM2mApplicationBodySchema,
                response: {
                    200: M2mApplicationSchema,
                    400: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const m2mApp = await req.repos.m2mApps.create(req.body);
            return reply.send(m2mApp);
        }
    );

    server.get(
        '/:id',
        {
            schema: {
                description: 'Get m2m application by id',
                tags: ['m2m-applications'],
                params: byIdSchema,
                response: {
                    200: M2mApplicationSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const m2mApp = await req.repos.m2mApps.getById(req.params.id);
            return reply.send(m2mApp);
        }
    );

    server.get(
        '/',
        {
            schema: {
                description: 'Search m2m applications with pagination',
                tags: ['m2m-applications'],
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedM2mApplicationsSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { limit, offset } = req.query;
            const m2mApps = await req.repos.m2mApps.searchPaginated({
                limit,
                offset
            });
            return reply.send(m2mApps);
        }
    );

    server.put(
        '/:id',
        {
            schema: {
                description: 'Update an m2m application by id',
                tags: ['m2m-applications'],
                params: byIdSchema,
                body: UpdateM2mApplicationBodySchema,
                response: {
                    200: M2mApplicationSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const updated = await req.repos.m2mApps.update(req.params.id, req.body);
            return reply.send(updated);
        }
    );

    server.delete(
        '/:id',
        {
            schema: {
                description: 'Delete an m2m application by id',
                tags: ['m2m-applications'],
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
            await req.repos.m2mApps.delete(req.params.id);
            return reply.status(204).send();
        }
    );

    server.get(
        '/:id/organizations',
        {
            schema: {
                description: 'Get selected organizations for an m2m application',
                tags: ['m2m-applications'],
                params: byIdSchema,
                response: {
                    200: z.array(OrganizationSummarySchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const organizations = await req.repos.m2mApps.getOrganizations(req.params.id);
            return reply.send(organizations);
        }
    );

    server.put(
        '/:id/organizations',
        {
            schema: {
                description: 'Replace selected organizations for an m2m application',
                tags: ['m2m-applications'],
                params: byIdSchema,
                body: replaceOrganizationsBodySchema,
                response: {
                    200: z.array(OrganizationSummarySchema),
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const organizations = await req.repos.m2mApps.replaceOrganizations(req.params.id, req.body.organizationIds);
            return reply.send(organizations);
        }
    );
}
