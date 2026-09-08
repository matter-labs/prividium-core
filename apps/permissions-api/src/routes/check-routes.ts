import type { FastifyServer } from '../build-app';
import { TargetTypes } from '../db/schema';
import { type EventPermissionVerifier, RULES_FINGERPRINT } from '../services/event-permission-verifier';
import { ForbiddenError } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { EventPermissionRulesResponseSchema } from './schemas/check';

type Deps = {
    eventVerifier: EventPermissionVerifier;
};

export function checkRoutes(server: FastifyServer, { eventVerifier }: Deps) {
    server.get(
        '/event-permission-rules',
        {
            schema: {
                description: 'Get event permission rules for the current user',
                tags: ['check', 'events', 'logs'],
                response: {
                    200: EventPermissionRulesResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            switch (req.auth.type) {
                case TargetTypes.enum.user:
                    return reply.send({
                        fingerprint: RULES_FINGERPRINT,
                        rules: await eventVerifier.getRules(req.auth.currentUser().id)
                    });
                default:
                    throw new ForbiddenError('Unsupported auth type');
            }
        }
    );
}
