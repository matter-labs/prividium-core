import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { ApplicationsService } from '../services/applications-service';
import { ErrorResponseSchema, PaginationQuerySchema, PublicIdSchema } from '../utils/schemas/fastify-common';
import { selfOriginFromRequest } from '../utils/self-origin';
import {
    ApplicationSchema,
    CreateApplicationBodySchema,
    PaginatedApplicationsSchema,
    UpdateApplicationBodySchema
} from './schemas/applications';

type Deps = {
    applicationsService: ApplicationsService;
};

const applicationIdParamSchema = z.strictObject({
    id: z.union([PublicIdSchema, z.enum(['admin-panel', 'block-explorer', 'proxy-cli', 'swagger-docs'])])
});

export function adminApplicationsRoutes(app: FastifyServer, { applicationsService }: Deps) {
    app.get(
        '/',
        {
            schema: {
                description: 'Returns a paginated list of applications',
                querystring: PaginationQuerySchema({ limit: { max: 1000 } }),
                response: {
                    200: PaginatedApplicationsSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const res = await applicationsService.searchPaginated(req.query, selfOriginFromRequest(req));
            return reply.send(res);
        }
    );

    app.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.APPLICATION_CREATE },
            schema: {
                description: 'Creates a new application',
                body: CreateApplicationBodySchema,
                response: {
                    200: ApplicationSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            return reply.send(await applicationsService.create(req.body));
        }
    );

    app.get(
        '/:id',
        {
            schema: {
                description: 'Searches an application by id',
                tags: ['Application'],
                params: applicationIdParamSchema,
                response: {
                    200: ApplicationSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            return reply.send(await applicationsService.getById(req.params.id, selfOriginFromRequest(req)));
        }
    );

    app.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.APPLICATION_UPDATE },
            schema: {
                description: 'Updates an app by id',
                tags: ['Application'],
                params: applicationIdParamSchema,
                body: UpdateApplicationBodySchema,
                response: {
                    200: ApplicationSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const updated = await applicationsService.update(req.params.id, req.body);
            return reply.send(updated);
        }
    );
    app.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.APPLICATION_DELETE },
            schema: {
                description: 'Deletes an app by id',
                tags: ['Application'],
                params: applicationIdParamSchema,
                response: {
                    204: z.undefined(),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            await applicationsService.delete(req.params.id);
            return reply.status(204).send();
        }
    );
}
