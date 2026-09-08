import { AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { StepUpRejected, type StepUpService } from '../services/step-up-service';

export const STEP_UP_PROOF_HEADER = 'x-step-up-proof';

export interface RequireStepUpDeps {
    stepUpService: StepUpService;
}

type Predicate = (request: FastifyRequest) => Promise<boolean> | boolean;

/**
 * Fastify preHandler factory: enforce that the caller has just completed a
 * WebAuthn step-up for `action`. On the first try the header is absent and we
 * respond 401 with a machine-parseable body the client uses to drive the
 * step-up ceremony; on retry the header is present and we atomically consume
 * the proof.
 */
export function requireStepUp(action: string, { stepUpService }: RequireStepUpDeps) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const proof = pickProofHeader(request);

        const operation = `${request.method} ${request.routeOptions.url ?? request.url}`;

        if (proof === undefined) {
            await request.auditContext?.logSecurityEvent(AUDIT_ACTIONS.PASSKEY_STEP_UP_REJECTED, 'request', undefined, {
                reason: 'missing',
                expectedAction: action,
                routeOperation: operation
            });
            return reply.status(401).send({ requiresStepUp: true, action });
        }

        const user = request.auth.currentUser();

        try {
            await stepUpService.consume({
                sessionTokenHash: request.auth.tokenHash,
                userId: user.id,
                action,
                proof
            });
        } catch (err) {
            if (err instanceof StepUpRejected) {
                await request.auditContext?.logSecurityEvent(
                    AUDIT_ACTIONS.PASSKEY_STEP_UP_REJECTED,
                    'request',
                    user.id,
                    {
                        reason: err.reason,
                        expectedAction: action,
                        routeOperation: operation
                    }
                );
                return reply.status(401).send({ requiresStepUp: true, action });
            }
            throw err;
        }

        await request.auditContext?.logSecurityEvent(AUDIT_ACTIONS.PASSKEY_STEP_UP_CONSUMED, 'request', user.id, {
            action,
            routeOperation: operation
        });
    };
}

/**
 * Like requireStepUp but only enforced when `predicate` returns true at request
 * time. Used for endpoints like POST /webauthn/register/begin where the first
 * enrollment (zero existing passkeys) is ungated and every subsequent enrollment
 * requires step-up.
 */
export function requireStepUpIfApplicable(action: string, predicate: Predicate, deps: RequireStepUpDeps) {
    const enforce = requireStepUp(action, deps);
    return async (request: FastifyRequest, reply: FastifyReply) => {
        if (!(await predicate(request))) return;
        return enforce(request, reply);
    };
}

/**
 * Sync form for routes that declare `preHandler` as a HookHandlerDoneFunction.
 */
export function requireStepUpSync(action: string, deps: RequireStepUpDeps) {
    const async = requireStepUp(action, deps);
    return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        async(request, reply).then(() => done(), done);
    };
}

function pickProofHeader(request: FastifyRequest): string | undefined {
    const raw = request.headers[STEP_UP_PROOF_HEADER];
    if (raw === undefined) return undefined;
    if (Array.isArray(raw)) return raw[0];
    return raw;
}
