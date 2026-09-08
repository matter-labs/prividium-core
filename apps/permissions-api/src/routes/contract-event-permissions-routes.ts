import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import {
    CreateEventPermissionBodySchema,
    EventPermissionSchema,
    UpdateEventPermissionBodySchema
} from './schemas/contract-event-permissions';

const withIdSchema = z.object({ id: z.string() });
const paginationSchema = PaginationQuerySchema({ limit: { max: 1000 } });

type Deps = {
    multiOrgEnabled: boolean;
};

export function contractEventPermissionsRoutes(server: FastifyServer, { multiOrgEnabled }: Deps) {
    // organizationOnly dropped from every schema while MULTI_ORG_ENABLED is off
    const eventPermissionSchema = multiOrgEnabled
        ? EventPermissionSchema
        : EventPermissionSchema.omit({ organizationOnly: true });
    const createBodySchema = multiOrgEnabled
        ? CreateEventPermissionBodySchema
        : CreateEventPermissionBodySchema.omit({ organizationOnly: true });
    const updateBodySchema = multiOrgEnabled
        ? UpdateEventPermissionBodySchema
        : UpdateEventPermissionBodySchema.omit({ organizationOnly: true });
    const paginatedSchema = paginatedResult(eventPermissionSchema);
    server.get(
        '/',
        {
            schema: {
                description: 'Lists existing event permissions with pagination',
                tags: ['event-permissions'],
                querystring: paginationSchema,
                response: {
                    200: paginatedSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { limit, offset } = request.query;
            return request.repos.contractEventsPermissions.findPaginated({
                limit,
                offset
            });
        }
    );

    server.get(
        '/:id',
        {
            schema: {
                description: 'Get an event permission by id',
                tags: ['event-permissions'],
                params: withIdSchema,
                response: {
                    200: eventPermissionSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            return request.repos.contractEventsPermissions.getById(request.params.id);
        }
    );

    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_EVENT_PERMISSION_CREATE },
            schema: {
                description: 'Create a new event permission (an event-level authorization rule)',
                tags: ['event-permissions'],
                body: createBodySchema,
                response: {
                    201: eventPermissionSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const created = await request.repos.contractEventsPermissions.create(request.body);
            return reply.status(201).send(created);
        }
    );

    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_EVENT_PERMISSION_UPDATE },
            schema: {
                description: 'Update an event permission',
                tags: ['event-permissions'],
                params: withIdSchema,
                body: updateBodySchema,
                response: {
                    200: eventPermissionSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            return request.repos.contractEventsPermissions.updateById(request.params.id, request.body);
        }
    );

    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_EVENT_PERMISSION_DELETE },
            schema: {
                description: 'Delete an event permission',
                tags: ['event-permissions'],
                params: withIdSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            await request.repos.contractEventsPermissions.deleteById(request.params.id);
            return reply.status(204).send();
        }
    );
}
