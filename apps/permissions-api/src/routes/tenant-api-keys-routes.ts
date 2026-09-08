import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { ApiKeyService } from '../services/api-key-service';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { ApiKeyWithSecretSchema, createApiKeyBodySchema, PaginatedApiKeysSchema } from './schemas/api-keys';

type Deps = {
    apiKeyService: ApiKeyService;
    apiKeyMaxExpirationSeconds: number;
};

// Params schemas
const tenantIdParamsSchema = z.object({ tenantId: z.string() });
const keyIdParamsSchema = z.object({ tenantId: z.string(), keyId: z.string() });

export function tenantApiKeysRoutes(server: FastifyServer, { apiKeyService, apiKeyMaxExpirationSeconds }: Deps) {
    const createBodySchema = createApiKeyBodySchema(apiKeyMaxExpirationSeconds);

    // Verify tenant exists for all routes
    server.addHook('preHandler', async (req) => {
        const { tenantId } = req.params as { tenantId: string };
        await req.repos.tenants.getById(tenantId);
    });

    // Create API key
    server.post(
        '/:tenantId/api-keys',
        {
            config: { audit_action: AUDIT_ACTIONS.API_KEY_CREATE },
            schema: {
                description: 'Create a new API key for a tenant (returns full key only once)',
                tags: ['tenant-api-keys'],
                params: tenantIdParamsSchema,
                body: createBodySchema,
                response: {
                    201: ApiKeyWithSecretSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { tenantId } = req.params;

            // Generate API key
            const { fullKey, keyHash, keyPrefix } = apiKeyService.generate();

            const created = await req.repos.apiKeys.create({
                tenantId,
                name: req.body.name,
                keyHash,
                keyPrefix,
                expiresAt: req.body.expiresAt
            });

            return reply.status(201).send({
                ...omitKeyHash(created),
                fullKey
            });
        }
    );

    // List API keys for tenant
    server.get(
        '/:tenantId/api-keys',
        {
            schema: {
                description: 'List API keys for a tenant (paginated)',
                tags: ['tenant-api-keys'],
                params: tenantIdParamsSchema,
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedApiKeysSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { tenantId } = req.params;
            const result = await req.repos.apiKeys.findByTenantId(tenantId, req.query);

            const sanitizedItems = result.items.map(omitKeyHash);

            return reply.send({
                ...result,
                items: sanitizedItems
            });
        }
    );

    // Revoke API key
    server.delete(
        '/:tenantId/api-keys/:keyId',
        {
            config: { audit_action: AUDIT_ACTIONS.API_KEY_REVOKE },
            schema: {
                description: 'Revoke an API key',
                tags: ['tenant-api-keys'],
                params: keyIdParamsSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { tenantId, keyId } = req.params;
            await req.repos.apiKeys.revoke(keyId, tenantId);
            return reply.status(204).send();
        }
    );
}

function omitKeyHash<T extends { keyHash: string }>(obj: T): Omit<T, 'keyHash'> {
    const { keyHash: _, ...rest } = obj;
    return rest;
}
