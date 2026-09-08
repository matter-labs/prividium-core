import { AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyServer } from '../build-app';
import type { StepUpService } from '../services/step-up-service';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import {
    StepUpBeginRequestSchema,
    StepUpBeginResponseSchema,
    StepUpFinishRequestSchema,
    StepUpProofResponseSchema
} from '../utils/schemas/webauthn';

interface StepUpRoutesDeps {
    stepUpService: StepUpService;
}

export function stepUpRoutes(server: FastifyServer, { stepUpService }: StepUpRoutesDeps) {
    server.post(
        '/webauthn/step-up/begin',
        {
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_STEP_UP_BEGIN },
            schema: {
                description: 'Begin a WebAuthn step-up ceremony for the given action',
                tags: ['webauthn'],
                body: StepUpBeginRequestSchema,
                response: {
                    200: StepUpBeginResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    429: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const user = req.auth.currentUser();
            const { action } = req.body;
            return stepUpService.begin({ user, action });
        }
    );

    server.post(
        '/webauthn/step-up/finish',
        {
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_STEP_UP_VERIFIED },
            schema: {
                description: 'Complete a WebAuthn step-up ceremony and receive a single-use proof token',
                tags: ['webauthn'],
                body: StepUpFinishRequestSchema,
                response: {
                    200: StepUpProofResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const user = req.auth.currentUser();
            const { action, assertion } = req.body;
            try {
                const { proof, expiresAt } = await stepUpService.finish({
                    user,
                    sessionTokenHash: req.auth.tokenHash,
                    action,
                    assertion
                });
                return { proof, expiresAt: expiresAt.toISOString() };
            } catch (err) {
                await req.auditContext?.logSecurityEvent(AUDIT_ACTIONS.PASSKEY_STEP_UP_FAILED, 'passkey', user.id, {
                    action,
                    attemptedCredentialId: assertion.id,
                    failureReason: err instanceof Error ? err.message : 'Unknown error'
                });
                throw err;
            }
        }
    );
}
