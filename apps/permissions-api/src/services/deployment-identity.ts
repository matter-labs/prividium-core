import type { ChainType } from '@repo/api-kit';
import type { Repositories } from '#db/index';

/** Refuses a database another chain type stamped; one without a stamp passes. */
export async function assertDatabaseChainType(repos: Repositories, chainType: ChainType): Promise<void> {
    const stamped = await repos.deploymentIdentity.find();
    if (stamped !== undefined && stamped !== chainType) {
        throw new Error(`The database serves '${stamped}'; this deployment is configured for '${chainType}'`);
    }
}

export async function claimDatabase(repos: Repositories, chainType: ChainType): Promise<void> {
    await repos.deploymentIdentity.insertIfAbsent(chainType);
    await assertDatabaseChainType(repos, chainType);
}
