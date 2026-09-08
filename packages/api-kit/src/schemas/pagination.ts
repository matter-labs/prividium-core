import { z } from 'zod/v4';

export interface PaginationParams {
    limit: number;
    offset: number;
}

export const paginatedResult = <Item extends z.core.SomeType>(i: Item) =>
    z.object({
        items: z.array(i),
        pagination: z.object({
            currentPage: z.number(),
            totalPages: z.number(),
            totalItems: z.number(),
            limit: z.number(),
            offset: z.number()
        })
    });

export type PaginatedResult<T> = z.infer<ReturnType<typeof paginatedResult<z.ZodType<T>>>>;
