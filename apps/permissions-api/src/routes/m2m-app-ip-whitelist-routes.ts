import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { withOverbroadFlag } from '../utils/cidr';
import { ErrorResponseSchema, PaginationQuerySchema, PublicIdSchema } from '../utils/schemas/fastify-common';
import { CreateIpWhitelistBodySchema, IpWhitelistSchema, PaginatedIpWhitelistSchema } from './schemas/ip-whitelist';

const createIpWhitelistBodySchema = CreateIpWhitelistBodySchema.omit({ tenantId: true, m2mAppId: true });

const m2mAppIdParamsSchema = z.strictObject({ m2mAppId: PublicIdSchema });
const entryIdParamsSchema = z.strictObject({ m2mAppId: PublicIdSchema, entryId: PublicIdSchema });

type Deps = {
    allowAnyCidr: boolean;
};

export function m2mAppIpWhitelistRoutes(server: FastifyServer, { allowAnyCidr }: Deps) {
    server.addHook('preHandler', async (req) => {
        const { m2mAppId } = req.params as { m2mAppId: string };
        await req.repos.m2mApps.getById(m2mAppId);
    });

    server.post(
        '/:m2mAppId/ip-whitelist',
        {
            schema: {
                description: 'Add an IP address to the m2m application whitelist',
                tags: ['m2m-app-ip-whitelist'],
                params: m2mAppIdParamsSchema,
                body: createIpWhitelistBodySchema,
                response: {
                    201: IpWhitelistSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const created = await req.repos.ipWhitelist.create(
                {
                    m2mAppId: req.params.m2mAppId,
                    ipAddress: req.body.ipAddress,
                    description: req.body.description
                },
                { allowAnyCidr }
            );
            return reply.status(201).send(withOverbroadFlag(created));
        }
    );

    server.get(
        '/:m2mAppId/ip-whitelist',
        {
            schema: {
                description: 'List IP whitelist entries for an m2m application (paginated)',
                tags: ['m2m-app-ip-whitelist'],
                params: m2mAppIdParamsSchema,
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedIpWhitelistSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const result = await req.repos.ipWhitelist.findByM2mAppId(req.params.m2mAppId, req.query);
            return reply.send({ items: result.items.map(withOverbroadFlag), pagination: result.pagination });
        }
    );

    server.delete(
        '/:m2mAppId/ip-whitelist/:entryId',
        {
            schema: {
                description: 'Remove an IP address from the m2m application whitelist',
                tags: ['m2m-app-ip-whitelist'],
                params: entryIdParamsSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            await req.repos.ipWhitelist.deleteForM2mApp(req.params.entryId, req.params.m2mAppId);
            return reply.status(204).send();
        }
    );
}
