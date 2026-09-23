import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core/session';
import { Pool, type PoolClient } from 'pg';

export interface DbLogger {
    error(obj: unknown, msg?: string): void;
}

export type DbQueryOutcome = 'ok' | 'error';

export interface DbInstrumentation {
    onQuery(durationMs: number, outcome: DbQueryOutcome): void;
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
    connectionTimeoutMs: number = 5_000,
    instrumentation?: DbInstrumentation
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

    if (instrumentation) {
        instrumentPool(pool, instrumentation);
    }

    return pool;
}

export type PoolState = { max: number; total: number; active: number; idle: number; waiting: number };

export function poolState(pool: Pool): PoolState {
    return {
        max: pool.options.max,
        total: pool.totalCount,
        active: pool.totalCount - pool.idleCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
    };
}

type QueryFn = (...args: unknown[]) => unknown;

function instrumentPool(pool: Pool, instrumentation: DbInstrumentation): void {
    const instrumentedClients = new WeakSet<PoolClient>();

    pool.query = timed(pool.query.bind(pool), instrumentation) as Pool['query'];

    // `acquire` fires on every checkout path; the pool reuses client objects, hence the guard.
    pool.on('acquire', (client) => {
        if (instrumentedClients.has(client)) {
            return;
        }
        instrumentedClients.add(client);
        client.query = timed(client.query.bind(client), instrumentation) as PoolClient['query'];
    });
}

// Promise form only: pool.query runs its own callback-form client query, which must not count twice.
function timed(query: QueryFn, instrumentation: DbInstrumentation): QueryFn {
    return (...args: unknown[]) => {
        if (typeof args.at(-1) === 'function' || isSubmittable(args[0])) {
            return query(...args);
        }
        const startedAt = performance.now();
        const report = (outcome: DbQueryOutcome) => instrumentation.onQuery(performance.now() - startedAt, outcome);
        return Promise.resolve(query(...args)).then(
            (result) => {
                report('ok');
                return result;
            },
            (error: unknown) => {
                report('error');
                throw error;
            }
        );
    };
}

function isSubmittable(value: unknown): boolean {
    return typeof value === 'object' && value !== null && typeof (value as { submit?: unknown }).submit === 'function';
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
