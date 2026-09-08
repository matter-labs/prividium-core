import { and, count, gt, type SQL } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core/columns/common';
import type { DbOrTx } from '../db';
import { getFirstOrThrow } from '../db/utils';

/**
 * Rate limiting function that given a drizzle table,
 * an array of WHERE filters and window parameters,
 * rate limits the response according to its `createdAt` column.
 */
export async function rateLimit({
    additionalFilters = [],
    windowCount,
    windowTimeInSeconds,
    tx,
    table
}: {
    additionalFilters?: SQL[];
    windowCount: number;
    windowTimeInSeconds: number;
    tx: DbOrTx;
    table: AnyPgTable & {
        createdAt: AnyPgColumn<{ columnType: 'PgTimestamp' }>;
    };
}) {
    const windowStart = new Date(Date.now() - windowTimeInSeconds * 1000);
    const recordsCount = await tx
        .select({ count: count() })
        .from(table)
        .where(and(...additionalFilters, gt(table.createdAt, windowStart)))
        .then(getFirstOrThrow)
        .then((c) => c.count);

    return { rateLimited: recordsCount >= windowCount };
}
