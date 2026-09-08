import { describe, expect, it } from 'vitest';
import { ErrorResponseSchema, PaginationQuerySchema } from './fastify-common';

describe('ErrorResponseSchema', () => {
    it('should validate valid error response', () => {
        const validError = {
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid input provided'
            }
        };

        const result = ErrorResponseSchema.safeParse(validError);
        expect(result.success).toBe(true);
        expect(result.data?.error.code).toBe('VALIDATION_ERROR');
        expect(result.data?.error.message).toBe('Invalid input provided');
    });

    it('should validate error response with issues', () => {
        const errorWithIssues = {
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Multiple validation errors',
                issues: [
                    { field: 'email', message: 'Invalid email format' },
                    { field: 'age', message: 'Must be at least 18' }
                ]
            }
        };

        const result = ErrorResponseSchema.safeParse(errorWithIssues);
        expect(result.success).toBe(true);
        expect(result.data?.error.issues).toHaveLength(2);
    });

    it('should reject error without required fields', () => {
        const invalidError = {
            error: {
                code: 'ERROR_CODE'
                // missing message
            }
        };

        const result = ErrorResponseSchema.safeParse(invalidError);
        expect(result.success).toBe(false);
    });

    it('should reject non-object error field', () => {
        const invalidError = {
            error: 'This is not an object'
        };

        const result = ErrorResponseSchema.safeParse(invalidError);
        expect(result.success).toBe(false);
    });
});

describe('PaginationQuerySchema', () => {
    describe('with default config', () => {
        const schema = PaginationQuerySchema();

        it('should validate with default values', () => {
            const result = schema.safeParse({});
            expect(result.success).toBe(true);
            expect(result.data?.limit).toBe(10);
            expect(result.data?.offset).toBe(0);
        });

        it('should accept valid limit and offset', () => {
            const result = schema.safeParse({ limit: 50, offset: 20 });
            expect(result.success).toBe(true);
            expect(result.data?.limit).toBe(50);
            expect(result.data?.offset).toBe(20);
        });

        it('should coerce string numbers', () => {
            const result = schema.safeParse({ limit: '25', offset: '10' });
            expect(result.success).toBe(true);
            expect(result.data?.limit).toBe(25);
            expect(result.data?.offset).toBe(10);
        });

        it('should reject limit below minimum', () => {
            const result = schema.safeParse({ limit: 0 });
            expect(result.success).toBe(false);
        });

        it('should reject limit above maximum', () => {
            const result = schema.safeParse({ limit: 1001 });
            expect(result.success).toBe(false);
        });

        it('should reject negative limit', () => {
            const result = schema.safeParse({ limit: -1 });
            expect(result.success).toBe(false);
        });

        it('should reject non-integer limit', () => {
            const result = schema.safeParse({ limit: 10.5 });
            expect(result.success).toBe(false);
        });

        it('should reject negative offset', () => {
            const result = schema.safeParse({ offset: -1 });
            expect(result.success).toBe(false);
        });

        it('should reject non-integer offset', () => {
            const result = schema.safeParse({ offset: 10.5 });
            expect(result.success).toBe(false);
        });

        it('should reject unknown query parameters', () => {
            const result = schema.safeParse({ limit: 10, offset: 0, misspelledFilter: 'value' });
            expect(result.success).toBe(false);
        });
    });

    describe('with custom config', () => {
        const schema = PaginationQuerySchema({
            limit: { min: 5, max: 50, default: 20 },
            offset: { default: 10 }
        });

        it('should use custom defaults', () => {
            const result = schema.safeParse({});
            expect(result.success).toBe(true);
            expect(result.data?.limit).toBe(20);
            expect(result.data?.offset).toBe(10);
        });

        it('should respect custom min limit', () => {
            const result = schema.safeParse({ limit: 4 });
            expect(result.success).toBe(false);
        });

        it('should respect custom max limit', () => {
            const result = schema.safeParse({ limit: 51 });
            expect(result.success).toBe(false);
        });

        it('should accept valid values within custom range', () => {
            const result = schema.safeParse({ limit: 30, offset: 15 });
            expect(result.success).toBe(true);
            expect(result.data?.limit).toBe(30);
            expect(result.data?.offset).toBe(15);
        });
    });
});
