import type { FastifyRequest } from 'fastify';

export const DOCS_SESSION_COOKIE_NAME = 'prividium_docs_session';

export function isDocsRequest(request: FastifyRequest): boolean {
    return request.url === '/docs' || request.url.startsWith('/docs/') || request.url.startsWith('/docs?');
}
