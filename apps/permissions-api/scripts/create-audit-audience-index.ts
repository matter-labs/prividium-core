import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { loadEnv } from '../src/env';

const env = loadEnv();
const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_ENABLE_SSL ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED } : false,
    max: 1
});

try {
    await pool.query(await readFile(new URL('./create-audit-audience-index.sql', import.meta.url), 'utf8'));
} finally {
    await pool.end();
}
