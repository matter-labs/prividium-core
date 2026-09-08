import type { FastifyServer } from '../build-app';
import { type AuditLogsService, auditLogContext } from '../services/audit-logs-service';
import type { SiweChallengeService } from '../services/siwe-challenge-service';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import {
    CreateServiceLoginSiweMsgSchema,
    CreateTenantLoginSiweMsgSchema,
    CreateUserLoginSiweMsgSchema,
    SiweMsgSchema
} from './schemas/siwe';

type Deps = {
    siweChallengeService: SiweChallengeService;
    auditLogsService: AuditLogsService;
    tenantsEnabled: boolean;
};

export function siweMessageRoutes(
    server: FastifyServer,
    { siweChallengeService, auditLogsService, tenantsEnabled }: Deps
) {
    server.post(
        '/',
        {
            schema: {
                body: CreateUserLoginSiweMsgSchema,
                tags: ['siwe-message'],
                response: {
                    200: SiweMsgSchema,
                    400: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const context = auditLogContext(req, auditLogsService);
            const newSiweMsg = await siweChallengeService.createForLogin(req.body, context, req.ip);
            return reply.send(newSiweMsg);
        }
    );

    if (tenantsEnabled) {
        server.post(
            '/tenants',
            {
                schema: {
                    description: 'creates a siwe message to login as a tenant',
                    body: CreateTenantLoginSiweMsgSchema,
                    tags: ['siwe-message'],
                    response: {
                        200: SiweMsgSchema
                    }
                }
            },
            async (req, reply) => {
                const newSiweMsg = await siweChallengeService.createForTenant(req.body, req.ip);
                return reply.send(newSiweMsg);
            }
        );
    }

    server.post(
        '/services',
        {
            schema: {
                description: 'creates a siwe message to login as a service',
                body: CreateServiceLoginSiweMsgSchema,
                tags: ['siwe-message'],
                response: {
                    200: SiweMsgSchema
                }
            }
        },
        async (req, reply) => {
            const newSiweMsg = await siweChallengeService.createForService(req.body, req.ip);
            return reply.send(newSiweMsg);
        }
    );
}
