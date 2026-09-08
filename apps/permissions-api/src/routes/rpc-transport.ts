import cors, { type FastifyCorsOptions } from '@fastify/cors';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ZodType } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { rpcErrorHandler } from '../rpc/error-handler';
import { InvalidRpcRequest } from '../rpc/errors';
import { type JsonRpcResponse, requestOrBatch } from '../rpc/json-rpc';
import { rpcReqSchema } from '../rpc/rpc-service';
import type { PinoLogger } from '../utils/logger';

export type RpcTransportRequest = Omit<FastifyRequest, 'log'> & { log: PinoLogger };

type RpcTransportOptions = {
    path: string;
    role: string;
    preHandler: preHandlerHookHandler | preHandlerHookHandler[];
    cors: FastifyCorsOptions | false;
    schema?: {
        params?: ZodType;
        body?: ZodType;
    };
    execute: (request: RpcTransportRequest) => Promise<JsonRpcResponse | JsonRpcResponse[]>;
};

declare module 'fastify' {
    interface FastifyReply {
        rpcRoute: string;
        rpcStatusCode: number;
        metricRpcHandlerRole: string;
    }
}

export function rpcTransport(app: FastifyServer, options: RpcTransportOptions): void {
    app.register(cors);
    app.setErrorHandler(rpcErrorHandler);
    app.decorateRequest('rpcRequestId', '');

    app.addHook('preValidation', async (request) => {
        const parsed = requestOrBatch.safeParse(request.body);
        if (!parsed.success) {
            request.setDecorator('rpcRequestId', null);
            throw new InvalidRpcRequest('Bad rpc request', parsed.error.message);
        }

        request.setDecorator('rpcRequestId', Array.isArray(parsed.data) ? 'unknown' : parsed.data.id);
    });

    app.post(
        options.path,
        {
            schema: options.schema,
            config: { cors: options.cors },
            preHandler: options.preHandler
        },
        async (request, reply) => {
            reply.rpcRoute = rpcReqSchema.safeParse(request.body).data?.method ?? 'unknown';
            reply.metricRpcHandlerRole = options.role;

            const response = await options.execute(request);
            reply.rpcStatusCode = Array.isArray(response) ? getRpcErrorCode(response[0]) : getRpcErrorCode(response);
            return reply.header('content-type', 'application/json').send(response);
        }
    );
}

function getRpcErrorCode(response: JsonRpcResponse | undefined): number {
    if (response === undefined) return 0;
    return 'error' in response && response.error !== undefined ? response.error.code : 0;
}
