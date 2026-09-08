import type { Config } from 'drizzle-kit';
import { loadEnv } from './src/env';

const env = loadEnv();

export default {
    out: './drizzle',
    schema: './src/db/schema.ts',
    dialect: 'postgresql',
    dbCredentials: {
        url: env.DATABASE_URL,
        ssl: env.DATABASE_ENABLE_SSL
            ? env.DATABASE_SSL_REJECT_UNAUTHORIZED
                ? 'require'
                : { rejectUnauthorized: false }
            : false
    },
    casing: 'snake_case'
} satisfies Config;
