import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import {
    CLUSTER_URL,
    isPostgresRunning,
    startPostgres,
    stopTestDeps,
    templateDb,
    withAdminConnection
} from './test-db';

/** Several are allowed: one database can serve several services, each with its own
 * migrations table. */
export type MigrationSet = {
    folder: string;
    migrationsTable?: string;
};

export async function setupTestDatabase(
    migrations: string | readonly MigrationSet[],
    prefix: string
): Promise<(() => Promise<void>) | undefined> {
    const postgresStartTime = Date.now();
    // Check if postgres is running, start it if not
    const isRunning = await isPostgresRunning();

    if (!isRunning) {
        console.log('⏳ Postgres not running, starting up...');
        await startPostgres();

        // Wait for postgres to be fully ready
        while (!(await isPostgresRunning())) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const postgresSetupTime = Date.now() - postgresStartTime;
        console.log(`✅ Postgres startup completed in ${postgresSetupTime}ms`);
    } else {
        const postgresSetupTime = Date.now() - postgresStartTime;
        console.log(`✅ Postgres already running, check finished in ${postgresSetupTime}ms`);
    }

    // Database setup timing
    const dbSetupStartTime = Date.now();

    await withAdminConnection(async (adminPool) => {
        await adminPool.query(`DROP DATABASE IF EXISTS ${templateDb(prefix)} WITH (FORCE)`);
        await adminPool.query(`CREATE DATABASE ${templateDb(prefix)}`);
    });
    const tplPool = new Pool({ connectionString: `${CLUSTER_URL}/${templateDb(prefix)}`, max: 1 });
    const tplDb = drizzle(tplPool);
    // Applied in the order given: a later journal may reference tables an earlier
    // one creates, which is what a shared database means.
    for (const set of typeof migrations === 'string' ? [{ folder: migrations }] : migrations) {
        await migrate(tplDb, {
            migrationsFolder: set.folder,
            ...(set.migrationsTable === undefined ? {} : { migrationsTable: set.migrationsTable })
        });
    }
    await tplPool.end();

    // await withAdminConnection(async (adminPool) => {
    //     await adminPool.query(`ALTER DATABASE ${templateDb(prefix)} ALLOW_CONNECTIONS false`);
    // });

    const dbSetupTime = Date.now() - dbSetupStartTime;
    console.log(`✅ Template database setup completed in ${dbSetupTime}ms`);

    // Own-what-you-start: only tear down the stack if we started it here. If it was already
    // up (manual `deps:up` / CI's Start Services), leave it for warm reuse and `deps:logs`.
    return isRunning ? undefined : stopTestDeps;
}
