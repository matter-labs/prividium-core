import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db';
import { scriptLogger } from './script-logger';

// Reads only the database settings, not the API's full env schema: seeding a fresh database must not
// depend on the rest of the service being configured.
function databaseUrl(): string {
    const API_DIR = join(import.meta.dirname, '..');
    config({ path: [join(API_DIR, '.env'), join(API_DIR, '.env.local')], quiet: true });

    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    const { DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME } = process.env;
    if (!DATABASE_HOST || !DATABASE_PORT || !DATABASE_USER || !DATABASE_PASSWORD || !DATABASE_NAME) {
        throw new Error(
            'Missing database configuration. Set DATABASE_URL, or all of DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD and DATABASE_NAME.'
        );
    }

    const credentials = `${encodeURIComponent(DATABASE_USER)}:${encodeURIComponent(DATABASE_PASSWORD)}`;
    return `postgres://${credentials}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`;
}

async function main() {
    const db = createDb(databaseUrl(), scriptLogger);

    try {
        const seedSql = await readFile(join(import.meta.dirname, 'seed.sql'), 'utf-8');

        // Seed CLI (db:seed): executes a repo-owned .sql file with no substitution, and never runs on a
        // request path, so the raw-SQL warning is a false positive here.
        // nosemgrep: prividium-sqli-raw-sql-user-input
        await db.execute(sql.raw(seedSql));

        scriptLogger.info('Baseline roles applied.');
    } finally {
        await db.close();
    }
}

main().catch((e) => {
    scriptLogger.error(e, 'Failed to apply baseline roles');
    process.exit(1);
});
