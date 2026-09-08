import { AUDIT_ACTIONS } from '@repo/access-control';
import * as z from 'zod/v4';
import type { FastifyServer } from '../build-app';
import {
    fullContractPermissionSchema,
    newContractPermissionSchema,
    updateContractPermissionSchema
} from '../repositories/contract-function-permissions-repository';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { hexSchema } from '../utils/schemas/hex-schema';
import { paginatedResult } from '../utils/schemas/pagination';

const withIdSchema = z.object({ id: z.coerce.number() });

const paginationSchema = z.object({
    ...PaginationQuerySchema({ limit: { max: 1000 } }).shape,
    contractAddress: hexSchema.optional(),
    methodSelector: hexSchema.optional(),
    roleId: z.string().optional()
});

type Deps = {
    multiOrgEnabled: boolean;
};

export function contractPermissionsRoutes(server: FastifyServer, { multiOrgEnabled }: Deps) {
    // organizationOnly dropped from every schema while MULTI_ORG_ENABLED is off
    const fullPermissionSchema = multiOrgEnabled
        ? fullContractPermissionSchema
        : fullContractPermissionSchema.omit({ organizationOnly: true });
    const newPermissionSchema = multiOrgEnabled
        ? newContractPermissionSchema
        : newContractPermissionSchema.omit({ organizationOnly: true });
    const updatePermissionSchema = multiOrgEnabled
        ? updateContractPermissionSchema
        : updateContractPermissionSchema.omit({ organizationOnly: true });

    server.get(
        '/',
        {
            schema: {
                description: 'List contract permissions with pagination',
                tags: ['contract-permissions'],
                querystring: paginationSchema,
                response: {
                    200: paginatedResult(fullPermissionSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { limit, offset, contractAddress, methodSelector, roleId } = request.query;

            return await request.repos.contractFunctionPermissions.findPaginated(
                { contractAddress, methodSelector, roleId },
                { limit, offset }
            );
        }
    );

    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_FUNCTION_PERMISSION_CREATE },
            schema: {
                description: 'Create a new contract permission (a function-level authorization rule)',
                tags: ['contract-permissions'],
                body: newPermissionSchema,
                response: {
                    201: fullPermissionSchema,
                    400: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const permission = await request.repos.contractFunctionPermissions.create({
                ...request.body,
                methodSelector: request.body.methodSelector as `0x${string}`
            });
            return reply.status(201).send(permission);
        }
    );

    server.get(
        '/:id',
        {
            schema: {
                description: 'Get a contract permission by contract address and method selector',
                tags: ['contract-permissions'],
                params: withIdSchema,
                response: {
                    200: fullPermissionSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            return reply.send(await request.repos.contractFunctionPermissions.getPermissionById(request.params.id));
        }
    );

    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_FUNCTION_PERMISSION_UPDATE },
            schema: {
                description:
                    'Replace a contract permission by method selector (full update). The method and contract pointed by the permission cannot be changed.',
                tags: ['contract-permissions'],
                params: withIdSchema,
                body: updatePermissionSchema,
                response: {
                    200: fullPermissionSchema,
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const updated = await request.repos.contractFunctionPermissions.update(request.params.id, request.body);
            return reply.send(updated);
        }
    );

    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_FUNCTION_PERMISSION_DELETE },
            schema: {
                description: 'Delete a contract permission by method selector',
                tags: ['contract-permissions'],
                params: withIdSchema,
                response: {
                    204: z.void(),
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            await request.repos.contractFunctionPermissions.delete(request.params.id);
            return reply.status(204).send();
        }
    );
}
