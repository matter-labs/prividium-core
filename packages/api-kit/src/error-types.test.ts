import { describe, expect, it } from 'vitest';
import {
    EntityAlreadyExistsError,
    EntityNotFound,
    ForbiddenError,
    InvalidEntity,
    InvalidInputError,
    PermissionApiError,
    RateLimitError,
    UnauthorizedError,
    UnexpectedDbError
} from './error-types';

describe('Error Types', () => {
    describe('EntityAlreadyExistsError', () => {
        it('should have correct code and status', () => {
            const error = new EntityAlreadyExistsError('Entity exists');
            expect(error.code).toBe('ENTITY_ALREADY_EXISTS');
            expect(error.statusCode).toBe(409);
            expect(error.message).toBe('Entity exists');
        });
    });

    describe('EntityNotFound', () => {
        it('should have correct code and status', () => {
            const error = new EntityNotFound('User', { id: '123' });
            expect(error.code).toBe('NOT_FOUND');
            expect(error.statusCode).toBe(404);
            expect(error.message).toBe('User with id "123" not found');
        });
    });

    describe('InvalidInputError', () => {
        it('should have correct code and status', () => {
            const error = new InvalidInputError('Invalid input');
            expect(error.code).toBe('INVALID_INPUT_ERROR');
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe('Invalid input');
        });
    });

    describe('InvalidEntity', () => {
        it('should have correct code and status', () => {
            const error = new InvalidEntity('Invalid entity');
            expect(error.code).toBe('INVALID_ENTITY');
            expect(error.statusCode).toBe(422);
            expect(error.message).toBe('Invalid entity');
        });
    });

    describe('ForbiddenError', () => {
        it('should have correct code and status with custom message', () => {
            const error = new ForbiddenError('Custom forbidden');
            expect(error.code).toBe('FORBIDDEN_ERROR');
            expect(error.statusCode).toBe(403);
            expect(error.message).toBe('Custom forbidden');
        });

        it('should use default message when none provided', () => {
            const error = new ForbiddenError();
            expect(error.message).toBe('Forbidden access');
        });
    });

    describe('UnauthorizedError', () => {
        it('should have correct code and status', () => {
            const error = new UnauthorizedError('Unauthorized');
            expect(error.code).toBe('UNAUTHORIZED_ERROR');
            expect(error.statusCode).toBe(401);
            expect(error.message).toBe('Unauthorized');
        });
    });

    describe('RateLimitError', () => {
        it('should have correct code and status', () => {
            const error = new RateLimitError('Rate limited');
            expect(error.code).toBe('RATE_LIMIT_ERROR');
            expect(error.statusCode).toBe(429);
            expect(error.message).toBe('Rate limited');
            expect(error.retryAfterSeconds).toBeUndefined();
        });

        it('exposes retryAfterSeconds when provided', () => {
            const error = new RateLimitError('Slow down', { retryAfterSeconds: 42 });
            expect(error.retryAfterSeconds).toBe(42);
        });
    });

    describe('UnexpectedDbError', () => {
        it('should extend Error and have message', () => {
            const error = new UnexpectedDbError('DB error');
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('DB error');
        });

        it('should not be instance of PermissionApiError', () => {
            const error = new UnexpectedDbError('DB error');
            expect(error).not.toBeInstanceOf(PermissionApiError);
        });
    });

    describe('PermissionApiError inheritance', () => {
        it('should all extend PermissionApiError except UnexpectedDbError', () => {
            expect(new EntityAlreadyExistsError('test')).toBeInstanceOf(PermissionApiError);
            expect(new EntityNotFound('Test', { id: 'test' })).toBeInstanceOf(PermissionApiError);
            expect(new InvalidInputError('test')).toBeInstanceOf(PermissionApiError);
            expect(new InvalidEntity('test')).toBeInstanceOf(PermissionApiError);
            expect(new ForbiddenError('test')).toBeInstanceOf(PermissionApiError);
            expect(new UnauthorizedError('test')).toBeInstanceOf(PermissionApiError);
            expect(new RateLimitError('test')).toBeInstanceOf(PermissionApiError);
            expect(new UnexpectedDbError('test')).not.toBeInstanceOf(PermissionApiError);
        });
    });
});
