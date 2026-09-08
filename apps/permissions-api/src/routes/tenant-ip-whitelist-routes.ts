import { AUDIT_ACTIONS } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { withOverbroadFlag } from '../utils/cidr';
import { ErrorResponseSchema, PaginationQuerySchema, PublicIdSchema } from '../utils/schemas/fastify-common';
import { CreateIpWhitelistBodySchema, IpWhitelistSchema, PaginatedIpWhitelistSchema } from './schemas/ip-whitelist';

const createIpWhitelistBodySchema = CreateIpWhitelistBodySchema.omit({ tenantId: true });

// Params schemas
const tenantIdParamsSchema = z.strictObject({ tenantId: PublicIdSchema });
const entryIdParamsSchema = z.strictObject({ tenantId: PublicIdSchema, entryId: PublicIdSchema });

export function tenantIpWhitelistRoutes(server: FastifyServer) {
    // Verify tenant exists for all routes
    server.addHook('preHandler', async (req) => {
        const { tenantId } = req.params as { tenantId: string };
        await req.repos.tenants.getById(tenantId);
    });

    // Add IP to whitelist
    server.post(
        '/:tenantId/ip-whitelist',
        {
            config: { audit_action: AUDIT_ACTIONS.IP_WHITELIST_CREATE },
            schema: {
                description: 'Add an IP address to the tenant whitelist',
                tags: ['tenant-ip-whitelist'],
                params: tenantIdParamsSchema,
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
            const created = await req.repos.ipWhitelist.create({
                tenantId: req.params.tenantId,
                ipAddress: req.body.ipAddress,
                description: req.body.description
            });
            return reply.status(201).send(withOverbroadFlag(created));
        }
    );

    // List IP whitelist entries for tenant
    server.get(
        '/:tenantId/ip-whitelist',
        {
            schema: {
                description: 'List IP whitelist entries for a tenant (paginated)',
                tags: ['tenant-ip-whitelist'],
                params: tenantIdParamsSchema,
                querystring: PaginationQuerySchema(),
                response: {
                    200: PaginatedIpWhitelistSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const result = await req.repos.ipWhitelist.findByTenantId(req.params.tenantId, req.query);
            return reply.send({ items: result.items.map(withOverbroadFlag), pagination: result.pagination });
        }
    );

    // Remove IP from whitelist
    server.delete(
        '/:tenantId/ip-whitelist/:entryId',
        {
            config: { audit_action: AUDIT_ACTIONS.IP_WHITELIST_DELETE },
            schema: {
                description: 'Remove an IP address from the tenant whitelist',
                tags: ['tenant-ip-whitelist'],
                params: entryIdParamsSchema,
                response: {
                    204: z.void(),
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            await req.repos.ipWhitelist.deleteForTenant(req.params.entryId, req.params.tenantId);
            return reply.status(204).send();
        }
    );
}
