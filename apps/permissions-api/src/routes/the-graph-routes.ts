import httpProxy from '@fastify/http-proxy';
import type { FastifyServer } from '../build-app';

export function theGraphRoutes(server: FastifyServer, { theGraphApiUrl }: { theGraphApiUrl: string }) {
    server.register(httpProxy, {
        upstream: theGraphApiUrl,
        rewritePrefix: new URL(theGraphApiUrl).pathname
    });
}
