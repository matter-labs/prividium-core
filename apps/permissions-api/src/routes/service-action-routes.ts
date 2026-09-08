import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { prividiumPermix } from '../permissions/prividium-permix';
import { fullContractSchema } from '../repositories/contracts-repository';
import { EntityNotFound } from '../utils/error-types';
import { addressSchema } from '../utils/schemas/address';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { ServiceActionBodySchema, ServiceActionResponseSchema } from './schemas/service-action';

export function serviceActionRoutes(app: FastifyServer) {
    app.post(
        '/check-read-access',
        {
            schema: {
                description: 'allows a service to check if a user has full read access',
                body: ServiceActionBodySchema,
                response: {
                    200: ServiceActionResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const user = await req.repos.users.findByIdWithRoles(req.body.userId);
            if (!user) {
                throw new EntityNotFound('User', { id: req.body.userId });
            }

            const permix = prividiumPermix(user);
            return reply.send({ authorized: permix.check('sequencer', 'fullReadAccess') });
        }
    );

    app.get(
        '/contracts/:contractAddress',
        {
            schema: {
                description: 'Get a contract by address for service integrations',
                tags: ['services', 'contracts'],
                params: z.object({
                    contractAddress: addressSchema
                }),
                response: {
                    200: fullContractSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const contract = await req.repos.contracts.findByAddress(req.params.contractAddress);
            return reply.send(contract);
        }
    );
}
