import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseCredentials } from '@repo/api-kit';
import { parse } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const EXAMPLE_ENV = parse(readFileSync(fileURLToPath(new URL('../.env.example', import.meta.url))));
// Nothing listens on port 1, so a boot that reached the database would fail with a connection error instead.
const UNREACHABLE_URL = 'postgres://app@127.0.0.1:1/prividium_api?sslmode=verify-full';

describe('start: database credentials', () => {
    const ORIGINAL_ENV = process.env;
    let start: typeof import('./index').start;

    beforeAll(async () => {
        // `index.ts` reads its environment once, when imported.
        process.env = {
            ...EXAMPLE_ENV,
            NODE_ENV: 'production',
            SIWE_HMAC_SECRET: '444556204f4e4c5920686d61632073656372657420646f206e6f742075736521',
            DATABASE_AUTH: 'iam-token',
            DATABASE_URL: UNREACHABLE_URL
        };
        ({ start } = await import('./index'));
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it('refuses a DATABASE_AUTH mode no supplied provider claims, naming it', async () => {
        await expect(start({})).rejects.toThrow('DATABASE_AUTH=iam-token is not a mode this build supports');
    });

    it("fails with the provider's own error before migrations touch the database", async () => {
        const connect = vi.fn<DatabaseCredentials['connect']>(async () => {
            throw new Error('identity app-identity could not authenticate: token endpoint unreachable');
        });

        await expect(start({ databaseCredentials: { mode: 'iam-token', connect } })).rejects.toThrow(
            'identity app-identity could not authenticate: token endpoint unreachable'
        );
        expect(connect).toHaveBeenCalledWith({
            databaseUrl: UNREACHABLE_URL,
            connectionTimeoutMs: Number(EXAMPLE_ENV.DB_POOL_CONNECTION_TIMEOUT_MS)
        });
    });
});
