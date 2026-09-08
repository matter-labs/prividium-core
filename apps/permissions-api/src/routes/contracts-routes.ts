import { ADMIN_ROLE_ID, AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import {
    contractsByTemplateResponseSchema,
    createContractSchema,
    fullContractSchema,
    groupedContractsResponseSchema,
    updateContractSchema
} from '../repositories/contracts-repository';
import type { UserWithRoles } from '../repositories/users-repository';
import type { ExternalRpc } from '../rpc/target-rpc';
import { assertAddressHasCode } from '../services/contract-registration-guard';
import { isSystemContractAddress } from '../services/system-contracts/registry';
import { ForbiddenError, InvalidInputError } from '../utils/error-types';
import { areHexEqual } from '../utils/hex';
import { addressSchema } from '../utils/schemas/address';
import { ErrorResponseSchema, PaginationQuerySchema, SearchQuerySchema } from '../utils/schemas/fastify-common';

const contractAddressParamSchema = z.object({
    contractAddress: addressSchema
});

const templateIdParamSchema = z.object({
    templateId: z.coerce.number().int()
});

const contractResponseSchema = fullContractSchema;

// undefined defaults to the caller's org; null is zone-level (operators only); an id targets that org
export function resolveContractOwnerOrganizationId(
    caller: UserWithRoles,
    requested: string | null | undefined
): string | null {
    const isOperator = caller.roles.some((role) => role.id === ADMIN_ROLE_ID);
    if (isOperator) {
        return requested === undefined ? caller.organizationId : requested;
    }
    if (caller.organizationId === null) {
        throw new ForbiddenError('Users without an organization cannot own a contract');
    }
    if (requested === undefined || requested === caller.organizationId) {
        return caller.organizationId;
    }
    throw new ForbiddenError('Cannot assign a contract to another organization');
}

type Deps = {
    chainRpc: ExternalRpc;
};

const groupedContractsQuerySchema = PaginationQuerySchema({ limit: { max: 100 } }).extend({
    searchQuery: SearchQuerySchema.optional()
});

const contractsByTemplateQuerySchema = PaginationQuerySchema({ limit: { max: 1000 } }).extend({
    searchQuery: SearchQuerySchema.optional()
});

export function contractsRoutes(server: FastifyServer, { chainRpc }: Deps) {
    server.get(
        '/',
        {
            schema: {
                description:
                    'List contracts grouped by template. Returns template groups (with counts) followed by ungrouped contracts.',
                tags: ['contracts'],
                querystring: groupedContractsQuerySchema,
                response: {
                    200: groupedContractsResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { limit, offset, searchQuery } = request.query;
            return reply.send(await request.repos.contracts.findGrouped({ limit, offset, searchQuery }));
        }
    );

    server.get(
        '/by-template/:templateId',
        {
            schema: {
                description: 'List contracts for a specific template with pagination',
                tags: ['contracts'],
                params: templateIdParamSchema,
                querystring: contractsByTemplateQuerySchema,
                response: {
                    200: contractsByTemplateResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { templateId } = request.params;
            const { limit, offset, searchQuery } = request.query;
            return reply.send(
                await request.repos.contracts.findByTemplatePaginated({ templateId, limit, offset, searchQuery })
            );
        }
    );

    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_CREATE },
            schema: {
                description: 'Create a new contract',
                tags: ['contracts'],
                body: createContractSchema,
                response: {
                    201: contractResponseSchema,
                    400: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    503: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            if (isSystemContractAddress(request.body.contractAddress)) {
                throw new InvalidInputError('Cannot create a contract at a system contract address');
            }
            const organizationId = resolveContractOwnerOrganizationId(
                request.auth.currentUser(),
                request.body.organizationId
            );
            // These routes require zone-level `admin_write`, so the caller is always an operator and
            // the deployer match does not apply. See `assertOrgContractRegisterable`.
            await assertAddressHasCode(chainRpc, request.body.contractAddress);
            const contract = await request.repos.contracts.create({ ...request.body, organizationId });
            return reply.status(201).send(contract);
        }
    );

    server.get(
        '/:contractAddress',
        {
            schema: {
                description: 'Get a contract by address',
                tags: ['contracts'],
                params: contractAddressParamSchema,
                response: {
                    200: contractResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { contractAddress } = request.params;
            return reply.send(await request.repos.contracts.findByAddress(contractAddress));
        }
    );

    server.put(
        '/:contractAddress',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_UPDATE },
            schema: {
                description: 'Replace a contract (full update)',
                tags: ['contracts'],
                params: contractAddressParamSchema,
                body: updateContractSchema,
                response: {
                    200: contractResponseSchema,
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    409: ErrorResponseSchema,
                    503: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { contractAddress } = request.params;
            if (isSystemContractAddress(contractAddress)) {
                throw new InvalidInputError('Cannot modify a system contract');
            }
            if (isSystemContractAddress(request.body.contractAddress)) {
                throw new InvalidInputError('Cannot use a system contract address');
            }
            // A rewrite moves the permissions onto the new address, so it has to clear the same
            // bar as a fresh registration.
            if (!areHexEqual(contractAddress, request.body.contractAddress)) {
                await assertAddressHasCode(chainRpc, request.body.contractAddress);
            }
            const contract = await request.repos.contracts.update(contractAddress, request.body);

            if (contract.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) {
                try {
                    await request.auditContext.logSecurityEvent(
                        AUDIT_ACTIONS.CONTRACT_ADDRESS_CHANGE,
                        'contract',
                        contract.contractAddress,
                        { previousAddress: contractAddress, newAddress: contract.contractAddress }
                    );
                } catch (err) {
                    request.log.error({ err }, 'Failed to emit contract address-change audit event');
                }
            }

            return reply.send(contract);
        }
    );

    server.delete(
        '/:contractAddress',
        {
            config: { audit_action: AUDIT_ACTIONS.CONTRACT_DELETE },
            schema: {
                description: 'Delete a contract',
                tags: ['contracts'],
                params: contractAddressParamSchema,
                response: {
                    204: z.void(),
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { contractAddress } = request.params;
            if (isSystemContractAddress(contractAddress)) {
                throw new InvalidInputError('Cannot delete a system contract');
            }
            await request.repos.contracts.delete(contractAddress);
            return reply.status(204).send();
        }
    );
}
