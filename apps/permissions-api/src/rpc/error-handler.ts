import * as Sentry from '@sentry/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorLogContext } from '../utils/actor-log-context';
import { ForbiddenError, RateLimitError, UnauthorizedError } from '../utils/error-types';
import { redactSensitiveUrl } from '../utils/redact-url';
import {
    FORBIDDEN_ERROR_CODE,
    INTERNAL_RPC_ERROR,
    INVALID_REQUEST_ERROR_CODE,
    UNAUTHORIZED_ERROR_CODE
} from './constants';
import { ForbiddenRpcError, RpcException } from './errors';
import { errorResponse, type JsonRpcResponse } from './json-rpc';

export async function rpcErrorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
    const requestId = request.getDecorator('rpcRequestId') ?? null;

    if ('code' in error && error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
        return reply.status(200).send(
            errorResponse({
                id: requestId as JsonRpcResponse['id'],
                error: {
                    code: INVALID_REQUEST_ERROR_CODE,
                    message: 'invalid json body'
                }
            })
        );
    }

    if (error instanceof RpcException) {
        if (error instanceof ForbiddenRpcError) {
            // fallback: denials that escape the per-request handler (normally logged in rpc-service)
            request.log.warn(
                {
                    event: 'rpc.permission_denied',
                    actor: actorLogContext(request),
                    denialMessage: error.message,
                    reason: error.reason,
                    data: error.data
                },
                'RPC permission denied'
            );
        } else {
            request.log.debug(error);
        }
        return reply.status(200).send(
            errorResponse({
                id: requestId as JsonRpcResponse['id'],
                error: {
                    code: error.code,
                    message: error.message
                }
            })
        );
    }

    if (error instanceof ForbiddenError) {
        return reply.status(200).send(
            errorResponse({
                id: requestId as JsonRpcResponse['id'],
                error: {
                    code: FORBIDDEN_ERROR_CODE,
                    message: 'Forbidden'
                }
            })
        );
    }

    if (error instanceof UnauthorizedError) {
        return reply.status(200).send(
            errorResponse({
                id: requestId as JsonRpcResponse['id'],
                error: {
                    code: UNAUTHORIZED_ERROR_CODE,
                    message: 'Unauthorized'
                }
            })
        );
    }

    if (error instanceof RateLimitError) {
        return reply.status(429).send({
            error: {
                code: error.code,
                message: error.message
            }
        });
    }

    request.log.error(
        { err: error, url: redactSensitiveUrl(request.url), method: request.method },
        'Unexpected error reached error handler'
    );

    Sentry.captureException(error, {
        tags: { errorType: 'escaped-to-handler', service: 'api' },
        extra: { url: redactSensitiveUrl(request.url), method: request.method }
    });

    return reply.status(200).send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
            code: INTERNAL_RPC_ERROR,
            message: 'Internal error'
        }
    });
}
