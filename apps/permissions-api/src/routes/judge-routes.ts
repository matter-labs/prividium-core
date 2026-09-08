import type { FastifyServer } from '../build-app';
import type { JudgeService, JudgeTrace } from '../services/judge-service';
import { policyDecisionCounter } from '../utils/metrics';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { JudgeRequestSchema, JudgeResponseSchema } from './schemas/judge';

type Deps = {
    judgeService: JudgeService;
    // first entry is the preferred version
    protocolVersions: string[];
};

export function judgeRoutes(server: FastifyServer, { judgeService, protocolVersions }: Deps) {
    server.post(
        '/judge',
        {
            schema: {
                description:
                    'TxValidator judge check. Called by zksync-os-server after each user-submitted tx executes at block-build time. Receives a per-frame runtime trace and returns the policy decision.',
                tags: ['tx-policy'],
                body: JudgeRequestSchema,
                response: {
                    200: JudgeResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    500: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { protocolVersion: reqProtocolVersion, trace, accessType } = req.body;

            const decision = await judgeService.judge({
                protocolVersion: reqProtocolVersion,
                trace: trace as unknown as JudgeTrace,
                accessType
            });

            policyDecisionCounter.inc({
                route: 'judge',
                decision: decision.authorized ? 'allow' : 'deny',
                rule_id: decision.ruleId ?? 'none'
            });

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
