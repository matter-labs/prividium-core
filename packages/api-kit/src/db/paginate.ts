import type { PaginatedResult, PaginationParams } from '../schemas/pagination';

interface PaginateArgs<T> extends PaginationParams {
    /** Total row count for the active filter (before limit/offset); a value or a pending query. */
    totalItems: number | PromiseLike<number>;
    /** The requested page of items; a value or a pending query. */
    items: T[] | PromiseLike<T[]>;
}

/**
 * Shared pagination boilerplate: resolves the count and items queries and
 * assembles the standard pagination metadata around them.
 */
export async function paginate<T>(args: PaginateArgs<T>): Promise<PaginatedResult<T>> {
    const [totalItems, items] = await Promise.all([args.totalItems, args.items]);
    const { limit, offset } = args;

    return {
        items,
        pagination: {
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(totalItems / limit),
            totalItems,
            limit,
            offset
        }
    };
}
