import { TestDatabaseBuilder } from '@repo/test-deps';
import { it } from 'vitest';
import { createDb, type DB } from '../src/db';
import { TEMPLATE_DB_PREFIX } from './global-setup';

export type Fixture = {
    dbBuilder: TestDatabaseBuilder<DB>;
    db: DB;
};

const unitIt = it.extend<Fixture>({
    dbBuilder: [
        // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
        async ({}, use) => {
            const testDatabaseBuilder = new TestDatabaseBuilder<DB>((url, logger) =>
                createDb(url, logger, false, true, 10_000, 10_000, 2)
            );
            await use(testDatabaseBuilder);
            await testDatabaseBuilder.stop();
        },
        { scope: 'worker' }
    ],
    // A fresh clone per test, pre-cloned while the previous test ran and dropped in the background.
    db: async ({ dbBuilder }, use) => {
        const db = await dbBuilder.acquire(TEMPLATE_DB_PREFIX);
        await use(db);
        dbBuilder.release(db);
    }
});

export { unitIt as it };
