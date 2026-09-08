import z from 'zod/v4';

export const ErrorResponseSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        issues: z.array(z.any()).optional()
    })
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const PublicIdSchema = z
    .string()
    .length(21, 'ID must be a generated public id')
    .regex(/^[A-Za-z0-9_-]+$/, 'ID must contain only URL-safe characters');

export const SearchQuerySchema = z.string().max(200);

export const PaginationQuerySchema = (config?: {
    limit?: {
        min?: number;
        max?: number;
        default?: number;
    };
    offset?: {
        max?: number;
        default?: number;
    };
}) =>
    z.strictObject({
        limit: z.coerce
            .number()
            .int()
            .min(config?.limit?.min ?? 1)
            .max(config?.limit?.max ?? 1000)
            .default(config?.limit?.default ?? 10),
        offset: z.coerce
            .number()
            .int()
            .min(0)
            .max(config?.offset?.max ?? Number.MAX_SAFE_INTEGER)
            .default(config?.offset?.default ?? 0)
    });
