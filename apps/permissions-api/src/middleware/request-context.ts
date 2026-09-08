import { registerRequestContext } from '@repo/api-kit';
import type { FastifyServer } from '../build-app';
import type { Repositories } from '../db';
import { redactSensitiveUrl } from '../utils/redact-url';

declare module 'fastify' {
    interface FastifyRequest {
        repos: Repositories;
    }
}

/**
 * Binds the pool-backed `Repositories`. Audit-context later swaps in a
 * connection-scoped one on routes that take it.
 */
export function registerRequestContextMiddleware(app: FastifyServer, baseRepos: Repositories) {
    registerRequestContext(app, { sanitizeUrl: redactSensitiveUrl });

    app.addHook('onRequest', (request, _reply, done) => {
        request.repos = baseRepos;
        done();
    });
}
