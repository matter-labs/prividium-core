import type { AdmitDeniedHook } from '@repo/api-kit';
import type { FastifyServer } from '../build-app';
import type { AdmitService } from '../services/admit-service';
import { policyDecisionCounter } from '../utils/metrics';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { AdmitRequestSchema, AdmitResponseSchema } from './schemas/admit';

type Deps = {
    admitService: AdmitService;
    // first entry is the preferred version
    protocolVersions: string[];
    onAdmitDenied?: AdmitDeniedHook;
};

export function admitRoutes(server: FastifyServer, { admitService, protocolVersions, onAdmitDenied }: Deps) {
    server.post(
        '/admit',
        {
            schema: {
                description:
                    'TxValidator admit check. Called by zksync-os-server per user-submitted tx. Returns the policy decision with a stable ruleId identifying which rule decided.',
                tags: ['tx-policy'],
                body: AdmitRequestSchema,
                response: {
                    200: AdmitResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    500: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { protocolVersion: reqProtocolVersion, from, to, value, calldata, gasLimit, accessType } = req.body;

            const decision = await admitService.admit({
                protocolVersion: reqProtocolVersion,
                from,
                to,
                value: BigInt(value),
                calldata,
                gasLimit,
                accessType
            });

            policyDecisionCounter.inc({
                route: 'admit',
                decision: decision.authorized ? 'allow' : 'deny',
                rule_id: decision.ruleId ?? 'none'
            });

            if (!decision.authorized) {
                req.log.warn(
                    {
                        event: 'admit.permission_denied',
                        from,
                        to,
                        methodSelector: calldata.slice(0, 10),
                        accessType,
                        ruleId: decision.ruleId,
                        reason: decision.reason
                    },
                    'Admit policy denied'
                );
                await onAdmitDenied?.({
                    senderAddress: from,
                    targetAddress: to ?? null,
                    reason: decision.reason ?? null,
                    ruleId: decision.ruleId ?? null,
                    requestId: req.id ?? null
                });
            }

            // Echo the request version when supported; otherwise advertise the preferred.
            // `protocolVersions` is guaranteed non-empty (zod .min(1) on the env schema +
            // PolicyAppConfig contract).
            const responseVersion = protocolVersions.includes(reqProtocolVersion)
                ? reqProtocolVersion
                : protocolVersions[0]!;

            return reply.send({
                allow: decision.authorized,
                ruleId: decision.ruleId,
                reason: decision.reason,
                protocolVersion: responseVersion
            });
        }
    );
}
