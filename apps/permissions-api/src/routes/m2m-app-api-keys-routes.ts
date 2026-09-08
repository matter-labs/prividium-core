import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { ApiKeyService } from '../services/api-key-service';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { ApiKeyWithSecretSchema, createApiKeyBodySchema, PaginatedApiKeysSchema } from './schemas/api-keys';

type Deps = {
    apiKeyService: ApiKeyService;
    apiKeyMaxExpirationSeconds: number;
};

const m2mAppIdParamsSchema = z.object({ m2mAppId: z.string() });
const keyIdParamsSchema = z.object({ m2mAppId: z.string(), keyId: z.string() });

export function m2mAppApiKeysRoutes(server: FastifyServer, { apiKeyService, apiKeyMaxExpirationSeconds }: Deps) {
    const createBodySchema = createApiKeyBodySchema(apiKeyMaxExpirationSeconds);

    server.addHook('preHandler', async (req) => {
        const { m2mAppId } = req.params as { m2mAppId: string };
        await req.repos.m2mApps.getById(m2mAppId);
    });

    server.post(
        '/:m2mAppId/api-keys',
        {
            schema: {
                description: 'Create a new API key for an m2m application (returns full key only once)',
                tags: ['m2m-app-api-keys'],
                params: m2mAppIdParamsSchema,
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
            const { m2mAppId } = req.params;
            const { fullKey, keyHash, keyPrefix } = apiKeyService.generate();

            const created = await req.repos.apiKeys.create({
                m2mAppId,
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

    server.get(
        '/:m2mAppId/api-keys',
        {
            schema: {
                description: 'List API keys for an m2m application (paginated)',
                tags: ['m2m-app-api-keys'],
                params: m2mAppIdParamsSchema,
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedApiKeysSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { m2mAppId } = req.params;
            const result = await req.repos.apiKeys.findByM2mAppId(m2mAppId, req.query);

            return reply.send({
                ...result,
                items: result.items.map(omitKeyHash)
            });
        }
    );

    server.delete(
        '/:m2mAppId/api-keys/:keyId',
        {
            schema: {
                description: 'Revoke an API key for an m2m application',
                tags: ['m2m-app-api-keys'],
                params: keyIdParamsSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { m2mAppId, keyId } = req.params;
            await req.repos.apiKeys.revokeForM2mApp(keyId, m2mAppId);
            return reply.status(204).send();
        }
    );
}

function omitKeyHash<T extends { keyHash: string }>(obj: T): Omit<T, 'keyHash'> {
    const { keyHash: _, ...rest } = obj;
    return rest;
}
