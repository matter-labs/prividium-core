import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { hexSchema } from '../utils/schemas/hex-schema';
import { AuthorizedSchema } from './schemas/public-check';

const withAddressSchema = z.object({
    address: hexSchema
});

export function publicCheckRoutes(server: FastifyServer) {
    server.get(
        '/bytecode-disclosure',
        {
            schema: {
                description: 'Check if a contract is disclosing bytecode',
                tags: ['public-check', 'bytecode-disclosure'],
                querystring: withAddressSchema,
                response: {
                    200: AuthorizedSchema,
                    400: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const config = await req.repos.contracts.getBytecodeDisclosureConfig(req.query.address);
            return reply.send({ authorized: config !== null });
        }
    );

    server.get(
        '/supply-disclosure',
        {
            schema: {
                description: 'Checks if a given contract supply is disclosed to the public',
                tags: ['check', 'supply-disclosure'],
                querystring: withAddressSchema,
                response: {
                    200: AuthorizedSchema,
                    400: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { discloseErc20TotalSupply } = await req.repos.contracts
                .findByAddress(req.query.address)
                .catch(() => ({ discloseErc20TotalSupply: false }));

            return reply.send({ authorized: discloseErc20TotalSupply });
        }
    );
}
