import type { FastifyBaseLogger } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ErrorResponse } from '../schemas/fastify-common';

export type ApiServerOptions<TLogger extends FastifyBaseLogger> = {
    logger: TLogger;
    /** A string enables CIDR matching; an array matches exact IPs only. */
    trustProxy?: string | string[];
};

export function createApiServer<TLogger extends FastifyBaseLogger>({ logger, trustProxy }: ApiServerOptions<TLogger>) {
    const app = Fastify({ loggerInstance: logger, trustProxy }).withTypeProvider<ZodTypeProvider>();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    return app;
}

type NotFoundHost = {
    setNotFoundHandler(handler: (request: { method: string; url: string }, reply: NotFoundReply) => unknown): unknown;
};

type NotFoundReply = {
    status(code: number): { send(payload: ErrorResponse): unknown };
};

export function registerNotFoundHandler(app: NotFoundHost) {
    app.setNotFoundHandler((request, reply) => {
        return reply.status(404).send({
            error: {
                code: 'NOT_FOUND',
                message: `Route ${request.method}:${request.url} not found`
            }
        } satisfies ErrorResponse);
    });
}
