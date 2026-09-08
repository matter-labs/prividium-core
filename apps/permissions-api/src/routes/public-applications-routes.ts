import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { ApplicationsService } from '../services/applications-service';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { selfOriginFromRequest } from '../utils/self-origin';
import { PublicApplicationSchema } from './schemas/applications';

type Deps = {
    applicationsService: ApplicationsService;
};

export function publicApplicationsRoutes(app: FastifyServer, { applicationsService }: Deps) {
    app.get(
        '/:oauthClientId',
        {
            schema: {
                params: z.object({
                    oauthClientId: z.string()
                }),
                response: {
                    200: PublicApplicationSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const result = await applicationsService.getByOauthClientId(
                req.params.oauthClientId,
                selfOriginFromRequest(req)
            );
            reply.header('Cache-Control', 'no-store, private');
            return reply.send(result);
        }
    );
}
