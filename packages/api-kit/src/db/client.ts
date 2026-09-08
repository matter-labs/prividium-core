import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core/session';
import { Pool, type PoolClient } from 'pg';

export interface DbLogger {
    error(obj: unknown, msg?: string): void;
}

export type RawTx<TSchema extends Record<string, unknown>> = PgTransaction<
    NodePgQueryResultHKT,
    TSchema,
    ExtractTablesWithRelations<TSchema>
>;

export function createDbPool(
    databaseUrl: string,
    logger: DbLogger,
    enableSSL: boolean = false,
    rejectUnauthorized: boolean = true,
    queryTimeoutMs: number = 10_000,
    statementTimeoutMs: number = 10_000,
    maxConnections: number = 10,
    connectionTimeoutMs: number = 5_000
): Pool {
    const ssl = enableSSL ? (rejectUnauthorized ? true : { rejectUnauthorized: false }) : false;

    const pool = new Pool({
        connectionString: databaseUrl,
        query_timeout: queryTimeoutMs,
        statement_timeout: statementTimeoutMs,
        ssl,
        max: maxConnections,
        // Unset, node-postgres waits for a free connection forever, so one stalled request turns into a
        // permanent outage. Failing the acquire lets the caller error and give its own connection back.
        connectionTimeoutMillis: connectionTimeoutMs
    });

    // Prevent pool-level errors from crashing the process when the DB goes away.
    // We expect individual queries to fail and be handled at call sites.
    pool.on('error', (err) => {
        logger.error(err, 'PostgreSQL pool error (ignored for health)');
    });

    return pool;
}

/**
 * Acquires a dedicated pool connection, sets `app.job_id` as a session-level
 * config (so every Postgres audit trigger on that connection records the
 * background-job context), and calls `fn` with whatever `scopeTo` binds to that
 * connection.  The client is released when `fn` settles.
 *
 * Use this for background or startup mutations that run outside of an HTTP
 * request — otherwise `db_mutation_audit_logs` rows have both `request_id`
 * and `job_id` null, which breaks audit correlation.
 */
export async function withJobContext<TScoped, T>(
    pool: Pool,
    jobId: string,
    scopeTo: (client: PoolClient) => TScoped,
    fn: (scopedDb: TScoped) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query(`SELECT set_config('app.job_id', $1, false)`, [jobId]);
        return await fn(scopeTo(client));
    } finally {
        await client.query(`SELECT set_config('app.job_id', '', false)`);
        client.release();
    }
}
