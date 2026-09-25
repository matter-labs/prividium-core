import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import {
    createAuditedM2mApplication,
    deleteAuditedM2mApplication,
    replaceAuditedM2mOrganizations,
    updateAuditedM2mApplication
} from '../services/m2m-audit-service';
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
            config: { audit_action: AUDIT_ACTIONS.M2M_APP_CREATE },
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
            const { app, auditEventDetails } = await createAuditedM2mApplication(req.repos, req.body);
            req.auditEventDetails = auditEventDetails;
            return reply.send(app);
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
            config: { audit_action: AUDIT_ACTIONS.M2M_APP_UPDATE },
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
            req.auditEventDetails = { resourceType: 'm2m-app', resourceId: req.params.id };
            const { app, auditEventDetails } = await updateAuditedM2mApplication(
                req.repos,
                { appId: req.params.id },
                req.body
            );
            req.auditEventDetails = auditEventDetails;
            return reply.send(app);
        }
    );

    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.M2M_APP_DELETE },
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
            req.auditEventDetails = { resourceType: 'm2m-app', resourceId: req.params.id };
            req.auditEventDetails = await deleteAuditedM2mApplication(req.repos, { appId: req.params.id });
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
            config: { audit_action: AUDIT_ACTIONS.M2M_APP_ORGANIZATIONS_UPDATE },
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
            req.auditEventDetails = { resourceType: 'm2m-app', resourceId: req.params.id };
            const { organizations, auditEventDetails } = await replaceAuditedM2mOrganizations(
                req.repos,
                req.params.id,
                req.body.organizationIds
            );
            req.auditEventDetails = auditEventDetails;
            return reply.send(organizations);
        }
    );
}
