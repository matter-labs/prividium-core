import { createDbPool, type DbLogger, type RawTx, withJobContext } from '@repo/api-kit';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import * as schema from '../db/schema';
import { Repositories, type TxType } from './repositories';

export function createDb(
    databaseUrl: string,
    logger: DbLogger,
    enableSSL: boolean = false,
    rejectUnauthorized: boolean = true,
    queryTimeoutMs: number = 10_000,
    statementTimeoutMs: number = 10_000,
    maxConnections: number = 10,
    connectionTimeoutMs: number = 5_000
) {
    const pool = createDbPool(
        databaseUrl,
        logger,
        enableSSL,
        rejectUnauthorized,
        queryTimeoutMs,
        statementTimeoutMs,
        maxConnections,
        connectionTimeoutMs
    );

    const rawDb = drizzle(pool, { schema, casing: 'snake_case' });
    const db = Object.assign(rawDb, {
        repositories: () => new Repositories(db),
        close: async () => {
            await pool.end();
        }
    });
    return db;
}

export type DB = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle instance bound to a single `PoolClient`.
 * Used by the audit-context middleware to build a per-request `Repositories`
 * whose DB calls all share the same connection (and therefore the same
 * session-level `app.*` vars set before the handler runs).
 */
export function createRequestScopedDb(client: PoolClient): DbOrTx {
    const rawDb = drizzle(client, { schema, casing: 'snake_case' });
    const db = Object.assign(rawDb, {
        repositories: () => new Repositories(db)
    }) as unknown as DbOrTx;
    return db;
}

/** Raw Drizzle transaction — internal use only. Prefer {@link TxType} in application code. */
export type RawTxType = RawTx<typeof schema>;

export type DbOrTx = DB | TxType;

export function runWithJobContext<T>(db: DB, jobId: string, fn: (scopedDb: DbOrTx) => Promise<T>): Promise<T> {
    return withJobContext(db.$client, jobId, createRequestScopedDb, fn);
}

export { Repositories, type TxType };
