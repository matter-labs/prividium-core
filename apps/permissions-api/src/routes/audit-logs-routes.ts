import { AUDIT_ACTION_TYPES } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { auditActionTypeSchema } from '../db/schema';
import {
    AuditLogsSearchCriteriaSchema,
    DbMutationSearchCriteriaSchema,
    SelectAuditLogSchema,
    SelectDbMutationAuditLogSchema,
    SelectUnifiedAuditLogSchema
} from '../repositories/audit-logs-repository';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import { ActionTypesResponseSchema } from './schemas/audit-logs';

type Deps = {
    paginationMaxItems: number;
};

export function auditLogsRoutes(server: FastifyServer, { paginationMaxItems }: Deps) {
    const listQuerySchema = AuditLogsSearchCriteriaSchema.omit({ activeOrganizationId: true })
        .merge(
            PaginationQuerySchema({
                limit: { max: Math.min(1000, paginationMaxItems), default: 50 },
                offset: { max: paginationMaxItems - 1 }
            })
        )
        .refine(({ limit, offset }) => limit + offset <= paginationMaxItems, {
            message: `limit + offset must not exceed ${paginationMaxItems}`,
            path: ['offset']
        });

    server.get(
        '/',
        {
            schema: {
                description: 'List audit logs with pagination and filtering',
                tags: ['audit-logs'],
                querystring: listQuerySchema,
                response: {
                    200: paginatedResult(SelectAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { limit, offset, ...criteria } = request.query as z.infer<typeof AuditLogsSearchCriteriaSchema> & {
                limit: number;
                offset: number;
            };
            return reply.send(
                await request.repos.auditLogs.findPaginated(criteria, { limit, offset }, paginationMaxItems)
            );
        }
    );

    server.get(
        '/user/:userId',
        {
            schema: {
                description: 'Get audit logs for a specific user',
                tags: ['audit-logs'],
                params: z.object({
                    userId: z.string().min(1, 'User ID is required')
                }),
                querystring: z.strictObject({
                    limit: z.coerce.number().min(1).max(1000).default(50),
                    offset: z.coerce.number().min(0).default(0)
                }),
                response: {
                    200: paginatedResult(SelectAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { userId } = request.params;
            const { limit, offset } = request.query;
            return reply.send(await request.repos.auditLogs.findPaginated({ userId }, { limit, offset }));
        }
    );

    server.get(
        '/action/:actionType',
        {
            schema: {
                description: 'Get audit logs by action type',
                tags: ['audit-logs'],
                params: z.object({
                    actionType: auditActionTypeSchema
                }),
                querystring: z.strictObject({
                    limit: z.coerce.number().min(1).max(1000).default(50),
                    offset: z.coerce.number().min(0).default(0)
                }),
                response: {
                    200: paginatedResult(SelectAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { actionType } = request.params;
            const { limit, offset } = request.query;
            return reply.send(await request.repos.auditLogs.findPaginated({ actionType }, { limit, offset }));
        }
    );

    server.get(
        '/request/:requestId',
        {
            schema: {
                description: 'Get all audit logs for a specific HTTP request',
                tags: ['audit-logs'],
                params: z.object({
                    requestId: z.string().min(1, 'Request ID is required')
                }),
                querystring: z.strictObject({
                    limit: z.coerce.number().min(1).max(1000).default(50),
                    offset: z.coerce.number().min(0).default(0)
                }),
                response: {
                    200: paginatedResult(SelectAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { requestId } = request.params;
            const { limit, offset } = request.query;
            return reply.send(await request.repos.auditLogs.findPaginated({ requestId }, { limit, offset }));
        }
    );

    server.get(
        '/trace/:traceId',
        {
            schema: {
                description: 'Get all audit logs for a trace (spans multiple requests/services)',
                tags: ['audit-logs'],
                params: z.object({
                    traceId: z.string().min(1, 'Trace ID is required')
                }),
                querystring: z.strictObject({
                    limit: z.coerce.number().min(1).max(1000).default(50),
                    offset: z.coerce.number().min(0).default(0)
                }),
                response: {
                    200: paginatedResult(SelectAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { traceId } = request.params;
            const { limit, offset } = request.query;
            return reply.send(await request.repos.auditLogs.findPaginated({ traceId }, { limit, offset }));
        }
    );

    server.get(
        '/recent',
        {
            schema: {
                description:
                    'Get recent audit logs (last 24 hours) including DB-level mutations, filterable by user and action type',
                tags: ['audit-logs'],
                querystring: z.strictObject({
                    limit: z.coerce.number().min(1).max(1000).default(100),
                    offset: z.coerce.number().min(0).default(0),
                    userId: z.string().optional(),
                    actionType: auditActionTypeSchema.optional()
                }),
                response: {
                    200: paginatedResult(SelectUnifiedAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { limit, offset, userId, actionType } = request.query as {
                limit: number;
                offset: number;
                userId?: string;
                actionType?: z.infer<typeof auditActionTypeSchema>;
            };
            const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            return reply.send(
                await request.repos.auditLogs.findCombinedPaginated(
                    { userId, actionType, startDate },
                    { limit, offset }
                )
            );
        }
    );

    // db-level mutations, captured by postgres triggers
    server.get(
        '/db-mutations',
        {
            schema: {
                description: 'List DB-level mutation audit logs captured by Postgres triggers',
                tags: ['audit-logs'],
                querystring: DbMutationSearchCriteriaSchema.extend(
                    PaginationQuerySchema({ limit: { max: 1000, default: 50 } }).shape
                ),
                response: {
                    200: paginatedResult(SelectDbMutationAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { limit, offset, ...criteria } = request.query as z.infer<typeof DbMutationSearchCriteriaSchema> & {
                limit: number;
                offset: number;
            };
            return reply.send(await request.repos.auditLogs.findMutationsPaginated(criteria, { limit, offset }));
        }
    );

    server.get(
        '/db-mutations/request/:requestId',
        {
            schema: {
                description: 'Get all DB mutations captured during a specific HTTP request',
                tags: ['audit-logs'],
                params: z.object({ requestId: z.string().min(1) }),
                querystring: PaginationQuerySchema({ limit: { max: 1000, default: 50 } }),
                response: {
                    200: paginatedResult(SelectDbMutationAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { requestId } = request.params;
            const { limit, offset } = request.query as { limit: number; offset: number };
            return reply.send(await request.repos.auditLogs.findMutationsPaginated({ requestId }, { limit, offset }));
        }
    );

    server.get(
        '/db-mutations/trace/:traceId',
        {
            schema: {
                description: 'Get all DB mutations within a trace (spans multiple requests)',
                tags: ['audit-logs'],
                params: z.object({ traceId: z.string().min(1) }),
                querystring: PaginationQuerySchema({ limit: { max: 1000, default: 50 } }),
                response: {
                    200: paginatedResult(SelectDbMutationAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { traceId } = request.params;
            const { limit, offset } = request.query as { limit: number; offset: number };
            return reply.send(await request.repos.auditLogs.findMutationsPaginated({ traceId }, { limit, offset }));
        }
    );

    server.get(
        '/db-mutations/resource/:tableName/:primaryKey',
        {
            schema: {
                description: 'Get all DB mutations for a specific resource identified by table name and primary key',
                tags: ['audit-logs'],
                params: z.object({
                    tableName: z.string().min(1),
                    primaryKey: z.string().min(1)
                }),
                querystring: PaginationQuerySchema({ limit: { max: 1000, default: 50 } }),
                response: {
                    200: paginatedResult(SelectDbMutationAuditLogSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { tableName, primaryKey } = request.params;
            const { limit, offset } = request.query as { limit: number; offset: number };
            return reply.send(
                await request.repos.auditLogs.findMutationsPaginated({ tableName, primaryKey }, { limit, offset })
            );
        }
    );

    server.get(
        '/action-types',
        {
            schema: {
                description: 'Get all available audit action types',
                tags: ['audit-logs'],
                response: {
                    200: ActionTypesResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (_request, reply) => {
            const actionTypes = AUDIT_ACTION_TYPES;
            return reply.send({ actionTypes });
        }
    );
}
