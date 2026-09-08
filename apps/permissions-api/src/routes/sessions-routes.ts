import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { Session } from '../repositories/sessions-repository';
import { EntityNotFound } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { SessionsListSchema } from './schemas/sessions';

const sessionIdParamSchema = z.object({
    id: z.coerce.number().int().positive('Session ID must be a positive integer')
});

export function sessionsRoutes(server: FastifyServer) {
    server.get(
        '/',
        {
            schema: {
                description: 'List active sessions for current authenticated user',
                tags: ['sessions'],
                response: {
                    200: SessionsListSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const currentUser = request.auth.currentUser();
            const sessions = await request.repos.sessions.findActiveByUserId(currentUser.id);
            const currentTokenHash = request.auth.tokenHash;

            const items = sessions.map((session: Session) => ({
                id: session.id,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent,
                createdAt: session.createdAt,
                isCurrent: session.tokenHash === currentTokenHash
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
                tags: ['sessions'],
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
            const currentUser = request.auth.currentUser();
            const { id } = request.params;

            const sessionsRepo = request.repos.sessions;
            const sessions = await sessionsRepo.findActiveByUserId(currentUser.id);
            const sessionToRevoke = sessions.find((s) => s.id === id);

            if (!sessionToRevoke || sessionToRevoke.userId !== currentUser.id) {
                throw new EntityNotFound('Session', { id });
            }

            await sessionsRepo.revokeById(id, currentUser.id);
            return reply.status(204).send();
        }
    );

    server.post(
        '/revoke-others',
        {
            config: { audit_action: AUDIT_ACTIONS.SESSION_REVOKE_OTHERS },
            schema: {
                description: 'Revoke all sessions except the current one',
                tags: ['sessions'],
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const currentUser = request.auth.currentUser();
            const currentTokenHash = request.auth.tokenHash;

            await request.repos.sessions.revokeAllByUserIdExcept(currentUser.id, currentTokenHash, currentUser.id);
            return reply.status(204).send();
        }
    );
}
