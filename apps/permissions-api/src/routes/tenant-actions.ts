import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { TenantsService } from '../services/tenants-service';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import {
    CreateTenantUserBodySchema,
    PaginatedTenantUsersSchema,
    TenantSchema,
    TenantUserSchema,
    WalletAddressSchema
} from './schemas/tenants';

type Deps = {
    tenantsService: TenantsService;
};

export function tenantActions(app: FastifyServer, { tenantsService }: Deps) {
    app.get(
        '/me',
        {
            schema: {
                description: 'Returns data for the current tenant',
                tags: ['tenants'],
                response: {
                    200: TenantSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const tenant = req.auth.currentTenant();
            return reply.send({
                ...tenant,
                defaultRoles: tenant.defaultRoles.map((r) => ({
                    id: r.id,
                    roleName: r.roleName
                }))
            });
        }
    );

    app.post(
        '/users',
        {
            config: { audit_action: AUDIT_ACTIONS.TENANT_USER_CREATE },
            schema: {
                description: 'Creates a user associated with the current tenant',
                tags: ['tenants', 'users'],
                body: CreateTenantUserBodySchema,
                response: {
                    200: TenantUserSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const newUser = await tenantsService.createUser(req.auth.currentTenant().id, req.body);
            return reply.send(newUser);
        }
    );

    app.get(
        '/users',
        {
            schema: {
                description: 'Returns the list of users associated with current tenant',
                tags: ['tenants', 'users'],
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedTenantUsersSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const users = await req.repos.tenants.usersFor(req.auth.currentTenant().id, req.query);
            return reply.send(users);
        }
    );

    app.post(
        '/users/:userId/wallet',
        {
            config: { audit_action: AUDIT_ACTIONS.WALLET_ASSOCIATE },
            schema: {
                description: 'Associates given wallet with user',
                body: WalletAddressSchema.array(),
                params: z.object({ userId: z.string() }),
                response: {
                    200: TenantUserSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const updatedUser = await tenantsService.addWalletsToUser(
                req.auth.currentTenant().id,
                req.params.userId,
                req.body
            );
            return reply.send(updatedUser);
        }
    );
}
