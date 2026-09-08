import type { FastifyServer } from '../build-app';
import { contractDeploymentSchema } from '../repositories/contract-deployments-repository';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';

export function contractDeploymentRoutes(server: FastifyServer) {
    server.get(
        '/',
        {
            schema: {
                querystring: PaginationQuerySchema(),
                response: {
                    200: paginatedResult(contractDeploymentSchema),
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            return reply.send(await req.repos.contractDeployments.searchPaginated(req.query));
        }
    );
}
