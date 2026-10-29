import type { ChainType } from '@repo/api-kit';
import { type DB, type DbOrTx, runWithJobContext } from '#db/index';
import { assertDatabaseChainType, claimDatabase } from './deployment-identity';

export type DatabaseSteps = {
    /** Every pending migration; undefined where the test harness migrates. */
    migrate: (() => Promise<void>) | undefined;
    /** Startup mutations, on a connection stamped with job_id='system:startup' so their audit rows carry job context. */
    startup: (scopedDb: DbOrTx) => Promise<void>;
};

/** Refuses a database another chain type stamped before anything touches it; migrates, claims, then runs the startup mutations. */
export async function prepareDatabase(db: DB, chainType: ChainType, steps: DatabaseSteps): Promise<void> {
    await assertDatabaseChainType(db.repositories(), chainType);
    await steps.migrate?.();
    await runWithJobContext(db, 'system:startup', async (scopedDb) => {
        // First, so a database no deployment has claimed is stamped before anything below writes to it.
        await claimDatabase(scopedDb.repositories(), chainType);
        await steps.startup(scopedDb);
    });
}
