// biome-ignore lint/style/useNodejsImportProtocol: node: prefix causes type resolution issues with downstream consumers
import { spawn } from 'child_process';
// biome-ignore lint/style/useNodejsImportProtocol: node: prefix causes type resolution issues with downstream consumers
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import pino from 'pino';

export const CLUSTER_URL = 'postgres://postgres:notsecurepassword@localhost:5500';
const ADMIN_URL = `${CLUSTER_URL}/postgres`;
export const TEMPLATE_DB = 'permissions_template';

export function templateDb(prefix: string): string {
    return `${prefix}_template_db`;
}

const jsonTransport: pino.LoggerOptions = {
    messageKey: 'message',
    formatters: {
        level: (label: string) => ({ level: label })
    }
};

export function createLogger() {
    return pino(jsonTransport);
}

export async function withAdminConnection(fn: (poo: Pool) => Promise<void>) {
    const adminPool = new Pool({ connectionString: ADMIN_URL, max: 1 });
    await fn(adminPool);
    await adminPool.end();
}

export async function isPostgresRunning(): Promise<boolean> {
    try {
        const testPool = new Pool({ connectionString: ADMIN_URL, max: 1 });
        await testPool.query('SELECT 1');
        await testPool.end();
        return true;
    } catch {
        return false;
    }
}

export async function startPostgres(): Promise<void> {
    console.log('Starting postgres with pnpm deps:up...');

    return new Promise((resolve, reject) => {
        const child = spawn('pnpm', ['--filter', '@repo/test-deps', 'deps:up'], {
            stdio: 'inherit',
            shell: true
        });

        // Give postgres some time to start up
        const startupTimeout = setTimeout(() => {
            console.log('Postgres startup timeout, continuing...');
            resolve();
        }, 10000); // 10 seconds timeout

        child.on('error', (error) => {
            clearTimeout(startupTimeout);
            console.error('Error starting postgres:', error);
            reject(error);
        });

        // Check if postgres is running every 100ms
        const checkInterval = setInterval(async () => {
            if (await isPostgresRunning()) {
                clearTimeout(startupTimeout);
                clearInterval(checkInterval);
                console.log('Postgres is now running');
                resolve();
            }
        }, 100);
    });
}

export async function stopTestDeps(): Promise<void> {
    console.log('Stopping test dependencies with pnpm deps:down...');

    return new Promise((resolve) => {
        const child = spawn('pnpm', ['--filter', '@repo/test-deps', 'deps:down'], {
            stdio: 'inherit',
            shell: true
        });

        // A teardown failure must not turn an otherwise-green run red: log and resolve
        // regardless of exit code (unlike startPostgres, where a setup failure is fatal).
        child.on('error', (error) => {
            console.error('Error stopping test dependencies:', error);
            resolve();
        });
        child.on('close', () => resolve());
    });
}

export class TestDatabaseBuilder<TDB> {
    // biome-ignore lint/suspicious/noExplicitAny: generic DB factory accepts any logger
    private createDb: (url: string, logger: any) => TDB;
    private adminPool: Pool;
    private dbs: Map<TDB, { name: string; fn: () => void; promise: Promise<void> }>;
    // biome-ignore lint/suspicious/noExplicitAny: generic DB factory accepts any logger
    constructor(createDb: (url: string, logger: any) => TDB) {
        this.createDb = createDb;
        this.adminPool = new Pool({
            connectionString: ADMIN_URL,
            max: 1,
            // Shorter timeout than hook timeout to be able to debug if this times out
            query_timeout: 60_000,
            statement_timeout: 60_000
        });
        this.dbs = new Map();
    }

    private async cloneFromTemplate(prefix: string) {
        const name = `test_${randomUUID().replace(/-/g, '_')}`;
        await this.adminPool.query(`CREATE DATABASE ${name} TEMPLATE ${templateDb(prefix)}`);
        return { name, url: `${CLUSTER_URL}/${name}` };
    }

    async build(prefix: string): Promise<TDB> {
        const { url, name } = await this.cloneFromTemplate(prefix);
        const logger = createLogger();
        const db = await this.createDb(url, logger);

        let fn: () => void;
        const promise = new Promise<void>((resolve) => {
            fn = resolve;
        });

        this.dbs.set(db, { name, fn: fn!, promise });
        return db;
    }

    async stop(): Promise<void> {
        const allPromises = [...this.dbs.values()].map((v) => v.promise);
        await Promise.all(allPromises);

        await this.adminPool.end();
    }

    async tearDown(db: TDB): Promise<void> {
        const dbData = this.dbs.get(db);
        if (dbData === undefined) {
            throw new Error('unknown db');
        }
        await (db as { close: () => Promise<void> }).close();
        // Do not remove WITH (FORCE)
        // WITH (FORCE) is required: pool.end() may return while connections are still
        // draining (e.g. an in-flight rollback). Without it, DROP DATABASE silently
        // fails when lingering connections exist, leaving orphaned DBs that hold
        // catalog locks and block concurrent workers from cloning the template DB.
        await this.adminPool.query(`DROP DATABASE IF EXISTS ${dbData.name} WITH (FORCE)`);
        this.dbs.delete(db);
        dbData.fn();
    }

    async clearData(db: TDB) {
        await truncateTables(db as NodePgDatabase);
    }
}

// Postgres deadlock error code; see https://www.postgresql.org/docs/current/errcodes-appendix.html
const DEADLOCK_DETECTED = '40P01';

export async function truncateTables(db: NodePgDatabase) {
    const tableNames = await db.execute(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE';
    `);
    const names = tableNames.rows.map((row) => row.table_name) as string[];
    const truncateSql = `TRUNCATE ${names.join(', ')} CASCADE`;

    // The API server runs background work on the same DB while tests run
    // (audit-log onResponse hooks, scheduled cleanup jobs, health checks).
    // TRUNCATE acquires AccessExclusiveLock on every table; concurrent
    // INSERTs taking RowShareLocks for FK validation can deadlock with it.
    // Retry on 40P01: Postgres has already aborted the loser, so the next
    // attempt succeeds once the in-flight statement completes.
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await db.execute(truncateSql);
            return;
        } catch (err) {
            const code =
                (err as { code?: string; cause?: { code?: string } } | undefined)?.code ??
                (err as { cause?: { code?: string } } | undefined)?.cause?.code;
            if (code !== DEADLOCK_DETECTED || attempt === maxAttempts) {
                throw err;
            }
            await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        }
    }
}

export async function seedDatabase(db: NodePgDatabase, seedSql: string) {
    await db.execute(sql.raw(seedSql));
}
