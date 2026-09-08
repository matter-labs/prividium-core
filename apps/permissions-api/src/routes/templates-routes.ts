import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema, PaginationQuerySchema, SearchQuerySchema } from '../utils/schemas/fastify-common';
import {
    CreateTemplateBodySchema,
    PaginatedTemplatesSchema,
    TemplateSchema,
    UpdateTemplateBodySchema
} from './schemas/templates';

const templateIdParamSchema = z.object({
    id: z.coerce.number().int()
});

const listTemplatesQuerySchema = PaginationQuerySchema({ limit: { max: 1000 } }).extend({
    searchQuery: SearchQuerySchema.optional()
});

export function templatesRoutes(server: FastifyServer) {
    // List templates with pagination
    server.get(
        '/',
        {
            schema: {
                description: 'List templates with pagination',
                tags: ['templates'],
                querystring: listTemplatesQuerySchema,
                response: {
                    200: PaginatedTemplatesSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            return reply.send(await request.repos.templates.findPaginated(request.query));
        }
    );

    // Create template
    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.TEMPLATE_CREATE },
            schema: {
                description: 'Create a new template',
                tags: ['templates'],
                body: CreateTemplateBodySchema,
                response: {
                    201: TemplateSchema,
                    400: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const template = await request.repos.templates.create(request.body);
            return reply.status(201).send(template);
        }
    );

    // Get single template by id
    server.get(
        '/:id',
        {
            schema: {
                description: 'Get a template by id',
                tags: ['templates'],
                params: templateIdParamSchema,
                response: {
                    200: TemplateSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { id } = request.params;
            return reply.send(await request.repos.templates.getById(id));
        }
    );

    // Replace template (full update)
    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.TEMPLATE_UPDATE },
            schema: {
                description: 'Replace a template (full update)',
                tags: ['templates'],
                params: templateIdParamSchema,
                body: UpdateTemplateBodySchema,
                response: {
                    200: TemplateSchema,
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { id } = request.params;
            const template = await request.repos.templates.updateById(id, request.body);
            return reply.send(template);
        }
    );

    // Delete template
    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.TEMPLATE_DELETE },
            schema: {
                description: 'Delete a template',
                tags: ['templates'],
                params: templateIdParamSchema,
                response: {
                    204: z.void(),
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { id } = request.params;
            await request.repos.templates.deleteById(id);
            return reply.status(204).send();
        }
    );
}
