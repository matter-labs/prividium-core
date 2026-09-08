import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { Session } from '../repositories/sessions-repository';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { AdminSessionsListSchema } from './schemas/sessions';

const userIdQuerySchema = z.object({
    userId: z.string().min(1, 'User ID is required')
});

const sessionIdParamSchema = z.object({
    id: z.coerce.number().int().positive('Session ID must be a positive integer')
});

export function adminSessionsRoutes(server: FastifyServer) {
    server.get(
        '/',
        {
            schema: {
                description: 'List active sessions for a specific user (admin only)',
                tags: ['admin-sessions'],
                querystring: userIdQuerySchema,
                response: {
                    200: AdminSessionsListSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { userId } = request.query;
            const sessions = await request.repos.sessions.findActiveByUserId(userId);

            const items = sessions.map((session: Session) => ({
                id: session.id,
                userId: session.userId,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent,
                createdAt: session.createdAt
            }));

            return { items };
        }
    );

    server.post(
        '/:id/revoke',
        {
            config: { audit_action: AUDIT_ACTIONS.SESSION_REVOKE },
            schema: {
                description: 'Revoke a specific session by ID',
                tags: ['admin-sessions'],
                params: sessionIdParamSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const adminUser = request.auth.currentUser();
            const { id } = request.params;

            const sessionsRepository = request.repos.sessions;
            await sessionsRepository.getById(id);

            await sessionsRepository.revokeById(id, adminUser.id);
            return reply.status(204).send();
        }
    );

    server.post(
        '/revoke-all',
        {
            config: { audit_action: AUDIT_ACTIONS.SESSION_REVOKE_ALL },
            schema: {
                description: 'Revoke all sessions for a specific user',
                tags: ['admin-sessions'],
                querystring: userIdQuerySchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const adminUser = request.auth.currentUser();
            const { userId } = request.query;

            await request.repos.sessions.revokeAllByUserId(userId, adminUser.id);
            return reply.status(204).send();
        }
    );
}
