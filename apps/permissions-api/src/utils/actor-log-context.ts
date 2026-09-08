import type { FastifyRequest } from 'fastify';
import { assertNever } from './assert-never';

/**
 * Throw-safe actor descriptor for operator logs: reads only what is safe for the current auth.type.
 * Carries no secrets — authSubject is an id or hashed token, never a raw token.
 */
export type ActorLogContext = {
    actorType: string;
    actorId: string | null;
    authSubject: string | null;
    traceId: string | null;
    requestId: string | null;
};

export function actorLogContext(request: FastifyRequest): ActorLogContext {
    const auth = request.auth;
    const actorType = auth?.type ?? 'anonymous';

    let actorId: string | null = null;
    let authSubject: string | null = null;
    try {
        if (auth) {
            switch (auth.type) {
                case 'user':
                    actorId = auth.currentUser().id;
                    break;
                case 'tenant':
                    actorId = auth.currentTenant().id;
                    break;
                case 'service':
                    actorId = auth.currentService().id;
                    break;
                case 'm2m_app':
                    actorId = auth.currentM2mApp().id;
                    break;
                case 'anonymous':
                    break;
                default:
                    assertNever(auth.type);
            }
            authSubject = auth.isApiKeyAuth ? auth.currentApiKeyId() : (auth.tokenHash ?? null);
        }
    } catch (error) {
        // Best-effort: never let actor extraction throw on a logging path.
        request.log.error(error);
    }

    return {
        actorType,
        actorId,
        authSubject,
        traceId: request.traceId ?? null,
        requestId: request.requestId ?? null
    };
}
