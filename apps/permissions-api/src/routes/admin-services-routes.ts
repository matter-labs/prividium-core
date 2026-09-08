import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema, PaginationQuerySchema, PublicIdSchema } from '../utils/schemas/fastify-common';
import {
    CreateServiceBodySchema,
    PaginatedServicesSchema,
    ServiceSchema,
    UpdateServiceBodySchema
} from './schemas/services';

const byIdSchema = z.strictObject({
    id: PublicIdSchema
});

export function adminServicesRoutes(server: FastifyServer) {
    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.SERVICE_CREATE },
            schema: {
                description: 'Creates a new service',
                tags: ['services'],
                body: CreateServiceBodySchema,
                response: {
                    200: ServiceSchema,
                    400: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const service = await req.repos.services.create(req.body);
            return reply.send(service);
        }
    );

    server.get(
        '/:id',
        {
            schema: {
                description: 'Get service by id',
                tags: ['services'],
                params: byIdSchema,
                response: {
                    200: ServiceSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const service = await req.repos.services.getById(req.params.id);
            return reply.send(service);
        }
    );

    server.get(
        '/',
        {
            schema: {
                description: 'List services with pagination',
                tags: ['services'],
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedServicesSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { limit, offset } = req.query;
            const services = await req.repos.services.findPaginated({ limit, offset });
            return reply.send(services);
        }
    );

    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.SERVICE_UPDATE },
            schema: {
                description: 'Update a service by id',
                tags: ['services'],
                params: byIdSchema,
                body: UpdateServiceBodySchema,
                response: {
                    200: ServiceSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const updated = await req.repos.services.updateById(req.params.id, req.body);
            return reply.send(updated);
        }
    );

    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.SERVICE_DELETE },
            schema: {
                description: 'Delete a service by id',
                tags: ['services'],
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
            await req.repos.services.deleteById(req.params.id);
            return reply.status(204).send();
        }
    );
}
