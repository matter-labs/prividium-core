import { sql } from 'drizzle-orm';
import { describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { chainRegistry } from '../chains';
import { Repositories } from '../db';
import { assertDatabaseChainType, claimDatabase } from './deployment-identity';

// A chain type exists only once a module declares it; a bare ref stands in for a private chain module.
const chains = chainRegistry([
    { id: 'other-chain', chainTypes: ['other-chain'], load: () => Promise.reject(new Error('unused')) }
]);
const ZKSYNC_OS = chains.parse('zksync-os');
const BESU = chains.parse('besu');
const OTHER_CHAIN = chains.parse('other-chain');

describe('deployment chain type', () => {
    it('stamps a fresh database with the chain type', async ({ db }) => {
        const repos = new Repositories(db);

        await claimDatabase(repos, ZKSYNC_OS);

        expect(await repos.deploymentIdentity.find()).toBe('zksync-os');
    });

    it('accepts the chain type the database is stamped with', async ({ db }) => {
        const repos = new Repositories(db);
        await claimDatabase(repos, ZKSYNC_OS);

        await expect(assertDatabaseChainType(repos, ZKSYNC_OS)).resolves.toBeUndefined();
        await expect(claimDatabase(repos, ZKSYNC_OS)).resolves.toBeUndefined();
    });

    it('refuses a database stamped with another chain type', async ({ db }) => {
        const repos = new Repositories(db);
        await claimDatabase(repos, ZKSYNC_OS);

        for (const other of [BESU, OTHER_CHAIN]) {
            await expect(assertDatabaseChainType(repos, other)).rejects.toThrow(
                `The database serves 'zksync-os'; this deployment is configured for '${other}'`
            );
            await expect(claimDatabase(repos, other)).rejects.toThrow();
        }
        expect(await repos.deploymentIdentity.find()).toBe('zksync-os');
    });

    it('lets exactly one of two replicas booting together claim a fresh database', async ({ db }) => {
        const repos = new Repositories(db);

        const outcomes = await Promise.allSettled([claimDatabase(repos, ZKSYNC_OS), claimDatabase(repos, BESU)]);

        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
        const winner = outcomes[0]?.status === 'fulfilled' ? ZKSYNC_OS : BESU;
        expect(await repos.deploymentIdentity.find()).toBe(winner);
    });

    it('passes a database the stamp migration has not reached', async ({ db }) => {
        const repos = new Repositories(db);
        await db.execute(sql`DROP TABLE deployment_identity`);

        await expect(assertDatabaseChainType(repos, OTHER_CHAIN)).resolves.toBeUndefined();
    });
});
