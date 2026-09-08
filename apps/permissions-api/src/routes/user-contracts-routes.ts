import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { Repositories } from '../db';
import { ContractAbiService } from '../services/contract-abi-service';
import { addressSchema } from '../utils/schemas/address';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { ContractAbiResponseSchema } from './schemas/contracts';

const contractAddressParamSchema = z.object({
    contractAddress: addressSchema
});

type Deps = {
    repos: Repositories;
    multiOrgEnabled: boolean;
};

export function userContractsRoutes(server: FastifyServer, { repos, multiOrgEnabled }: Deps) {
    const contractAbiService = new ContractAbiService({ repos, multiOrgEnabled });

    server.get(
        '/:contractAddress/abi',
        {
            schema: {
                description:
                    'Get contract ABI filtered to only functions the authenticated user can access. ' +
                    'This allows dApps to fetch ABIs at runtime instead of bundling them, ' +
                    'preventing exposure of contract interfaces publicly.',
                tags: ['contracts', 'user'],
                params: contractAddressParamSchema,
                response: {
                    200: ContractAbiResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    422: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { contractAddress } = request.params;
            const user = request.auth.currentUser();

            const result = await contractAbiService.getFilteredAbi(user, contractAddress);

            return reply.send(result);
        }
    );
}
