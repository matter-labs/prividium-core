import { hasSystemPermission } from '@repo/access-control';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { SessionsAuthValidator } from '../middleware/sessions-auth';
import { prividiumPermix } from '../permissions/prividium-permix';
import type { SystemPermission } from '../permissions/system-permissions';
import { fullContractSchema } from '../repositories/contracts-repository';
import { EntityNotFound } from '../utils/error-types';
import { addressSchema } from '../utils/schemas/address';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { CheckUserReadAccessBodySchema, CheckUserReadAccessResponseSchema } from './schemas/m2m-app-queries';

const contractAddressParamsSchema = z.object({
    contractAddress: addressSchema
});

type Deps = {
    sessionAuthValidator: SessionsAuthValidator;
};

export function m2mAppQueriesRoutes(server: FastifyServer, { sessionAuthValidator }: Deps) {
    server.register((server: FastifyServer) => {
        server.addHook(
            'onRequest',
            sessionAuthValidator.buildHook({
                targets: [{ type: 'm2m_app' }]
            })
        );

        server.post(
            '/check-user-read-access',
            {
                schema: {
                    description: 'Allows an M2M application to check if a user has full read access',
                    tags: ['m2m-app-queries'],
                    body: CheckUserReadAccessBodySchema,
                    response: {
                        200: CheckUserReadAccessResponseSchema,
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
                if (!hasM2mAppPermission(req, 'check_user_read_access', user.organizationId)) {
                    throw new EntityNotFound('User', { id: req.body.userId });
                }
                const permix = prividiumPermix(user);
                return reply.send({ authorized: permix.check('sequencer', 'fullReadAccess') });
            }
        );

        server.get(
            '/contracts/:contractAddress',
            {
                schema: {
                    description: 'Get a contract by address for M2M application queries',
                    tags: ['m2m-app-queries', 'contracts'],
                    params: contractAddressParamsSchema,
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
                if (!hasM2mAppPermission(req, 'contract_metadata_read', contract.organizationId)) {
                    throw new EntityNotFound('contract', { contractAddress: req.params.contractAddress });
                }
                return reply.send(contract);
            }
        );
    });
}

function hasM2mAppPermission(req: FastifyRequest, permission: SystemPermission, orgId?: string | null): boolean {
    const m2mApp = req.auth.currentM2mApp();
    return hasSystemPermission(m2mApp, permission, orgId);
}
