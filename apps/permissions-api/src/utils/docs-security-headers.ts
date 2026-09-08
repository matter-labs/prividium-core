import type { FastifyReply } from 'fastify';

export const DOCS_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'";

export function applyDocsSecurityHeaders(reply: FastifyReply): void {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', DOCS_CSP);
}
