import type { FastifyServer } from '../build-app';
import type { ApplicationsService } from '../services/applications-service';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import { PublicApplicationCardSchema } from './schemas/applications';

type Deps = {
    applicationsService: ApplicationsService;
};

export function userApplicationsRoutes(app: FastifyServer, { applicationsService }: Deps) {
    app.get(
        '/',
        {
            schema: {
                description: 'Returns a paginated list of public applications',
                querystring: PaginationQuerySchema({ limit: { max: 100 } }),
                response: {
                    200: paginatedResult(PublicApplicationCardSchema),
                    401: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const res = await applicationsService.searchPublicPaginated(req.query);
            return reply.send(res);
        }
    );
}
