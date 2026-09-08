import type { FastifyRequest } from 'fastify';

export function selfOriginFromRequest(request: FastifyRequest): string {
    return `${request.protocol}://${request.host}`;
}
