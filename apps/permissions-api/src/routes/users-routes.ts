import { AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { WalletAssociationGuard } from '../services/wallet-association-guard';
import { EntityNotFound, InvalidInputError, WalletLimitExceededError } from '../utils/error-types';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import { CreateUserBodySchema, UpdateUserBodySchema, UserSchema } from './schemas/users';

const userIdParamSchema = z.object({
    id: z.string().min(1, 'User ID is required')
});

const baseUsersQuerySchema = z.object({
    ...PaginationQuerySchema({ limit: { max: 1000 } }).shape,
    roleId: z.string().optional(),
    displayName: z.string().optional()
});

const multiOrgUsersQuerySchema = baseUsersQuerySchema
    .extend({
        scope: z.enum(['zone', 'all']).default('zone'),
        /** Members of this organization only. */
        organizationId: z.string().optional(),
        sort: z.enum(['created', 'organization']).default('created')
    })
    .refine((query) => !(query.scope === 'all' && query.organizationId !== undefined), {
        error: 'scope=all and organizationId select disjoint sets; pass at most one',
        path: ['scope']
    });

type Deps = {
    walletAssociationGuard: WalletAssociationGuard;
    maxWalletsPerUser: number;
    multiOrgEnabled: boolean;
};

export function usersRoutes(
    server: FastifyServer,
    { walletAssociationGuard, maxWalletsPerUser, multiOrgEnabled }: Deps
) {
    // Scoping and ordering params are dropped while MULTI_ORG_ENABLED is off, so the endpoint behaves
    // exactly as it did before organizations existed.
    const usersQuerySchema = multiOrgEnabled ? multiOrgUsersQuerySchema : baseUsersQuerySchema;

    const roleScope = { allowZoneRoles: !multiOrgEnabled };

    // Members are managed here while multi-org is off; with it on, via the organization endpoints.
    async function assertManagedHere(request: FastifyRequest, id: string): Promise<void> {
        const user = await request.repos.users.findById(id);
        if (user === undefined) {
            throw new EntityNotFound('User', { id });
        }
        if (multiOrgEnabled && user.organizationId !== null) {
            throw new InvalidInputError('User belongs to an organization; manage them via the organization endpoints');
        }
    }

    // List users with pagination
    server.get(
        '/',
        {
            schema: {
                description:
                    'List users, oldest first (createdAt, then id). With MULTI_ORG_ENABLED the list is zone-level by default: scope=all covers the whole zone, organizationId scopes to one organization, and sort=organization lists zone users before members.',
                tags: ['users'],
                querystring: usersQuerySchema,
                response: {
                    200: paginatedResult(UserSchema),
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            // Without multi-org the scoping params are not accepted, so members are unreachable otherwise.
            const query = multiOrgEnabled ? request.query : { ...request.query, scope: 'all' as const };
            return await request.repos.users.findPaginated(query);
        }
    );

    // Create user
    server.post(
        '/',
        {
            config: { audit_action: AUDIT_ACTIONS.USER_CREATE_BY_ADMIN },
            schema: {
                description: 'Create a new user',
                tags: ['users'],
                body: CreateUserBodySchema.omit({ source: true }),
                response: {
                    201: UserSchema,
                    400: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            if ((request.body.wallets ?? []).length > maxWalletsPerUser) {
                throw new WalletLimitExceededError(maxWalletsPerUser);
            }
            walletAssociationGuard(request.body.wallets ?? []);
            const user = await request.repos.users.createFromAdminApi(request.body, roleScope);
            return reply.status(201).send(user);
        }
    );

    // Get single user
    server.get(
        '/:id',
        {
            schema: {
                description: 'Get a user by ID',
                tags: ['users'],
                params: userIdParamSchema,
                response: {
                    200: UserSchema,
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { id } = request.params;
            const user = await request.repos.users.findById(id);
            if (user === undefined) {
                throw new EntityNotFound('User', { id });
            }
            return user;
        }
    );

    // Replace user (full update)
    server.put(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.USER_UPDATE },
            schema: {
                description: 'Replace a user (full update)',
                tags: ['users'],
                params: userIdParamSchema,
                body: UpdateUserBodySchema,
                response: {
                    200: UserSchema,
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (request) => {
            const { id } = request.params;
            await assertManagedHere(request, id);
            if ((request.body.wallets ?? []).length > maxWalletsPerUser) {
                throw new WalletLimitExceededError(maxWalletsPerUser);
            }
            walletAssociationGuard(request.body.wallets ?? []);
            const user = await request.repos.users.update(id, request.body, roleScope);
            if (user === undefined) {
                throw new EntityNotFound('User', { id });
            }
            return user;
        }
    );

    // Delete user
    server.delete(
        '/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.USER_DELETE },
            schema: {
                description: 'Delete a user',
                tags: ['users'],
                params: userIdParamSchema,
                response: {
                    204: z.void(),
                    400: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { id } = request.params;
            await assertManagedHere(request, id);
            const success = await request.repos.users.delete(id);
            if (!success) {
                throw new EntityNotFound('User', { id });
            }
            return reply.status(204).send();
        }
    );
}
