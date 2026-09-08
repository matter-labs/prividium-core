import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
    interface FastifyRequest {
        requestId: string;
        traceId: string;
        requestStartedAt: number;
    }
}

type Hook = (request: FastifyRequest, reply: FastifyReply, done: () => void) => void;

/** Structural: Fastify's own instance generics are invariant and reject a typed server. */
export interface RequestHookHost {
    addHook(name: 'onRequest', handler: Hook): unknown;
    addHook(name: 'onResponse', handler: Hook): unknown;
}

export type RequestContextOptions = {
    sanitizeUrl?: (url: string) => string;
};

/**
 * An inbound `x-trace-id` is taken as-is, unvalidated, capped at 128 chars so
 * caller-supplied data cannot land unbounded in audit logs.
 */
export function registerRequestContext(app: RequestHookHost, { sanitizeUrl }: RequestContextOptions = {}) {
    const cleanUrl = sanitizeUrl ?? ((url: string) => url);

    app.addHook('onRequest', (request, _reply, done) => {
        request.requestId = randomUUID();

        const incoming = request.headers['x-trace-id'];
        request.traceId =
            typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128 ? incoming : randomUUID();

        request.requestStartedAt = Date.now();

        request.log.trace(
            {
                event: 'request.started',
                requestId: request.requestId,
                traceId: request.traceId,
                method: request.method,
                url: cleanUrl(request.url),
                ip: request.ip,
                userAgent: request.headers['user-agent']
            },
            'request.started'
        );

        done();
    });

    app.addHook('onResponse', (request, reply, done) => {
        const latencyMs = Date.now() - request.requestStartedAt;

        request.log.trace(
            {
                event: 'request.completed',
                requestId: request.requestId,
                traceId: request.traceId,
                method: request.method,
                url: cleanUrl(request.url),
                statusCode: reply.statusCode,
                latencyMs
            },
            'request.completed'
        );

        done();
    });
}
