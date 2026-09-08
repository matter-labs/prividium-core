import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { paginatedResult } from './pagination';

const validPagination = {
    currentPage: 1,
    totalPages: 5,
    totalItems: 42,
    limit: 10,
    offset: 0
};

describe('paginatedResult', () => {
    describe('with a primitive item schema', () => {
        const schema = paginatedResult(z.string());

        it('should accept a valid paginated result', () => {
            const result = schema.safeParse({
                items: ['a', 'b', 'c'],
                pagination: validPagination
            });
            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                items: ['a', 'b', 'c'],
                pagination: validPagination
            });
        });

        it('should accept an empty items array', () => {
            const result = schema.safeParse({
                items: [],
                pagination: { ...validPagination, totalItems: 0, totalPages: 0 }
            });
            expect(result.success).toBe(true);
            expect(result.data?.items).toEqual([]);
        });

        it('should reject items that do not match the item schema', () => {
            const result = schema.safeParse({
                items: ['a', 123],
                pagination: validPagination
            });
            expect(result.success).toBe(false);
        });

        it('should reject when items is not an array', () => {
            const result = schema.safeParse({
                items: 'not-an-array',
                pagination: validPagination
            });
            expect(result.success).toBe(false);
        });
    });

    describe('with an object item schema', () => {
        const schema = paginatedResult(z.object({ id: z.number(), name: z.string() }));

        it('should accept valid object items', () => {
            const result = schema.safeParse({
                items: [
                    { id: 1, name: 'alice' },
                    { id: 2, name: 'bob' }
                ],
                pagination: validPagination
            });
            expect(result.success).toBe(true);
            expect(result.data?.items).toHaveLength(2);
        });

        it('should reject object items with missing fields', () => {
            const result = schema.safeParse({
                items: [{ id: 1 }],
                pagination: validPagination
            });
            expect(result.success).toBe(false);
        });

        it('should reject object items with wrong field types', () => {
            const result = schema.safeParse({
                items: [{ id: 'one', name: 'alice' }],
                pagination: validPagination
            });
            expect(result.success).toBe(false);
        });
    });

    describe('pagination metadata', () => {
        const schema = paginatedResult(z.string());
        const paginationFields = ['currentPage', 'totalPages', 'totalItems', 'limit', 'offset'] as const;

        it('should reject when pagination is missing', () => {
            const result = schema.safeParse({ items: [] });
            expect(result.success).toBe(false);
        });

        it.each(paginationFields)('should reject when %s is missing', (field) => {
            const pagination = { ...validPagination };
            delete (pagination as Record<string, number>)[field];
            const result = schema.safeParse({ items: [], pagination });
            expect(result.success).toBe(false);
        });

        it.each(paginationFields)('should reject when %s is not a number', (field) => {
            const result = schema.safeParse({
                items: [],
                pagination: { ...validPagination, [field]: 'nope' }
            });
            expect(result.success).toBe(false);
        });
    });

    describe('top-level shape', () => {
        const schema = paginatedResult(z.string());

        it('should reject when items is missing', () => {
            const result = schema.safeParse({ pagination: validPagination });
            expect(result.success).toBe(false);
        });

        it('should reject null', () => {
            const result = schema.safeParse(null);
            expect(result.success).toBe(false);
        });

        it('should reject undefined', () => {
            const result = schema.safeParse(undefined);
            expect(result.success).toBe(false);
        });

        it('should reject a non-object', () => {
            const result = schema.safeParse('not-an-object');
            expect(result.success).toBe(false);
        });
    });
});
