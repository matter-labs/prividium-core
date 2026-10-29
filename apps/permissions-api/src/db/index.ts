import {
    connectionFromUrl,
    createDbPool,
    type DatabaseConnection,
    type DbInstrumentation,
    type DbLogger,
    type RawTx,
    withJobContext
} from '@repo/api-kit';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { Repositories, type TxType } from './repositories';
import * as schema from './schema';

export function createDb(
    target: string | DatabaseConnection,
    logger: DbLogger,
    enableSSL: boolean = false,
    rejectUnauthorized: boolean = true,
    queryTimeoutMs: number = 10_000,
    statementTimeoutMs: number = 10_000,
    maxConnections: number = 10,
    connectionTimeoutMs: number = 5_000,
    instrumentation?: DbInstrumentation,
    maxLifetimeSeconds: number = 0
) {
    const connection = typeof target === 'string' ? connectionFromUrl(target) : target;
    const pool = createDbPool(
        connection,
        logger,
        enableSSL,
        rejectUnauthorized,
        queryTimeoutMs,
        statementTimeoutMs,
        maxConnections,
        connectionTimeoutMs,
        instrumentation,
        maxLifetimeSeconds
    );

    const rawDb = drizzle(pool, { schema, casing: 'snake_case' });
    const db = Object.assign(rawDb, {
        repositories: () => new Repositories(db),
        close: async () => {
            await pool.end();
            await connection.close();
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
