import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLUSTER_URL, withAdminConnection } from '@repo/test-deps';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const DRIZZLE_DIR = path.join(__dirname, '..', 'drizzle');

export type DatabaseBeforeMigration = {
    pool: Pool;
    /** Applies the target migration in one transaction, as an upgrade does. */
    applyTarget: () => Promise<void>;
    drop: () => Promise<void>;
};

/** A scratch database migrated up to, not including, `targetTag`, so a test can seed the rows a live environment holds. */
export async function databaseBeforeMigration(targetTag: string): Promise<DatabaseBeforeMigration> {
    const dbName = `mig_test_${randomUUID().replace(/-/g, '_')}`;
    await withAdminConnection(async (admin) => {
        await admin.query(`CREATE DATABASE ${dbName}`);
    });
    const folder = migrationsFolderBefore(targetTag);
    const pool = new Pool({ connectionString: `${CLUSTER_URL}/${dbName}`, max: 1 });
    await migrate(drizzle(pool), { migrationsFolder: folder });
    return {
        pool,
        applyTarget: () => applyInTransaction(pool, migrationStatements(targetTag)),
        drop: async () => {
            await pool.end();
            await withAdminConnection(async (admin) => {
                await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
            });
            fs.rmSync(folder, { recursive: true, force: true });
        }
    };
}

// By tag, not position, so it stays correct as later migrations are added.
function migrationsFolderBefore(targetTag: string): string {
    const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
        entries: Array<{ tag: string }>;
    };
    const targetIdx = journal.entries.findIndex((entry) => entry.tag === targetTag);
    if (targetIdx === -1) {
        throw new Error(`${targetTag} not found in drizzle journal`);
    }
    const kept = journal.entries.slice(0, targetIdx);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `prividium-mig-pre-${targetTag}-`));
    fs.mkdirSync(path.join(folder, 'meta'));
    fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: kept }));
    for (const entry of kept) {
        fs.copyFileSync(path.join(DRIZZLE_DIR, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
    }
    return folder;
}

function migrationStatements(tag: string): string[] {
    return fs
        .readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
}

async function applyInTransaction(pool: Pool, statements: string[]): Promise<void> {
    await pool.query('BEGIN');
    try {
        for (const statement of statements) {
            await pool.query(statement);
        }
        await pool.query('COMMIT');
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
}
