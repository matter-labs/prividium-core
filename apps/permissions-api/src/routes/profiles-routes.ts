import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { UserWithRolesSchema } from './schemas/users';

export function profilesRoutes(server: FastifyServer) {
    server.get(
        '/me',
        {
            schema: {
                description: 'Get own user profile',
                tags: ['profiles'],
                response: {
                    200: UserWithRolesSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            // The user is guaranteed to exist and be up-to-date thanks to the preHandler
            return reply.send(req.auth.currentUser());
        }
    );
}
