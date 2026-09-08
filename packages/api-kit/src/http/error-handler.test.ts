import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseError } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresError } from '../db/errors';
import { createErrorHandler } from './error-handler';

const errorHandler = createErrorHandler({ serviceName: 'test-service' });

describe('errorHandler', () => {
    it.each([
        [PostgresError.UNIQUE_VIOLATION, 409, 'ENTITY_ALREADY_EXISTS', 'Entity already exists'],
        [PostgresError.FOREIGN_KEY_VIOLATION, 422, 'INVALID_ENTITY', 'Request violates entity constraints'],
        [PostgresError.CHECK_VIOLATION, 422, 'INVALID_ENTITY', 'Request violates entity constraints'],
        [PostgresError.INVALID_TEXT_REPRESENTATION, 422, 'INVALID_INPUT_ERROR', 'Invalid request value'],
        [PostgresError.NUMERIC_VALUE_OUT_OF_RANGE, 422, 'INVALID_INPUT_ERROR', 'Invalid request value'],
        [PostgresError.STRING_DATA_RIGHT_TRUNCATION, 422, 'INVALID_INPUT_ERROR', 'Invalid request value']
    ])('maps PostgreSQL error %s to a structured %s response', async (code, expectedStatus, expectedCode, message) => {
        const reply = createReply();

        await errorHandler(createDrizzlePostgresError(code), createRequest(), reply);

        expect(reply.status).toHaveBeenCalledWith(expectedStatus);
        expect(reply.send).toHaveBeenCalledWith({
            error: {
                code: expectedCode,
                message,
                issues: undefined
            }
        });
    });

    it('maps Drizzle no-values update errors to a structured 400 response', async () => {
        const reply = createReply();

        await errorHandler(new Error('No values to set') as FastifyError, createRequest(), reply);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(reply.send).toHaveBeenCalledWith({
            error: {
                code: 'INVALID_INPUT_ERROR',
                message: 'No fields to update',
                issues: undefined
            }
        });
    });
});

function createDrizzlePostgresError(code: string): FastifyError {
    const databaseError = new DatabaseError('postgres failed', 0, 'error');
    databaseError.code = code;

    return new DrizzleQueryError('select 1', [], databaseError) as unknown as FastifyError;
}

function createRequest(): FastifyRequest {
    return {
        raw: {
            url: '/test',
            method: 'POST'
        },
        log: {
            error: vi.fn()
        }
    } as unknown as FastifyRequest;
}

function createReply(): FastifyReply {
    const reply = {
        status: vi.fn(() => reply),
        send: vi.fn()
    };

    return reply as unknown as FastifyReply;
}
