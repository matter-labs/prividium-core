import * as Sentry from '@sentry/node';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { ZodError } from 'zod/v4';
import { isNoValuesToSetError, isPostgresError, PostgresError } from '../db/errors';
import { PermissionApiError, RateLimitError } from '../error-types';
import type { ErrorResponse } from '../schemas/fastify-common';

export type ErrorHandlerOptions = {
    serviceName: string;
};

export type ErrorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export function createErrorHandler({ serviceName }: ErrorHandlerOptions): ErrorHandler {
    return async function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
        // Handle input validation errors
        if (hasZodFastifySchemaValidationErrors(error)) {
            return replyWithError(reply, {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: "Request doesn't match the schema",
                issues: error.validation
            });
        }

        // Handle output validation errors
        if (isResponseSerializationError(error)) {
            request.log.error(
                { err: error, url: request.raw.url, method: request.raw.method, issues: error.cause.issues },
                'Response validation error'
            );
            Sentry.captureException(error, {
                tags: { errorType: 'response_serialization', service: serviceName },
                extra: { url: request.raw.url, method: request.raw.method, issues: error.cause.issues }
            });
            return replyWithError(reply, {
                status: 500,
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Internal server error'
            });
        }

        // Handle custom errors
        if (error instanceof PermissionApiError) {
            if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
                reply.header('Retry-After', String(error.retryAfterSeconds));
            }
            // Server-fault statuses carry an operational cause worth keeping; client faults do not.
            if (error.statusCode >= 500) {
                request.log.error(
                    { err: error, url: request.raw.url, method: request.raw.method },
                    'Route failed with a server-side error'
                );
            }
            return replyWithError(reply, {
                status: error.statusCode,
                code: error.code,
                message: error.message
            });
        }

        if (error instanceof ZodError) {
            return replyWithError(reply, {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: "Request doesn't match the schema",
                issues: error.issues
            });
        }

        if (isNoValuesToSetError(error)) {
            return replyWithError(reply, {
                status: 400,
                code: 'INVALID_INPUT_ERROR',
                message: 'No fields to update'
            });
        }

        const postgresError = mapPostgresError(error);
        if (postgresError) {
            return replyWithError(reply, postgresError);
        }

        // Log unexpected errors (500 internal server errors)
        request.log.error({ err: error, url: request.raw.url, method: request.raw.method }, 'Unhandled route error');

        // Capture unhandled exceptions in Sentry
        Sentry.captureException(error, {
            tags: { errorType: 'unhandled', service: serviceName },
            extra: { url: request.raw.url, method: request.raw.method }
        });

        // Return generic error for unexpected errors
        return replyWithError(reply, {
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error'
        });
    };
}

function mapPostgresError(error: unknown): { status: number; code: string; message: string } | undefined {
    if (!isPostgresError(error)) {
        return undefined;
    }

    switch (error.cause.code) {
        case PostgresError.UNIQUE_VIOLATION:
            return {
                status: 409,
                code: 'ENTITY_ALREADY_EXISTS',
                message: 'Entity already exists'
            };
        case PostgresError.FOREIGN_KEY_VIOLATION:
        case PostgresError.CHECK_VIOLATION:
            return {
                status: 422,
                code: 'INVALID_ENTITY',
                message: 'Request violates entity constraints'
            };
        case PostgresError.INVALID_TEXT_REPRESENTATION:
        case PostgresError.NUMERIC_VALUE_OUT_OF_RANGE:
        case PostgresError.STRING_DATA_RIGHT_TRUNCATION:
            return {
                status: 422,
                code: 'INVALID_INPUT_ERROR',
                message: 'Invalid request value'
            };
        default:
            return undefined;
    }
}

function replyWithError(
    reply: FastifyReply,
    { status, code, message, issues }: { status: number; code: string; message: string; issues?: unknown[] }
) {
    return reply.status(status).send({
        error: {
            code,
            message,
            issues
        }
    } satisfies ErrorResponse);
}
