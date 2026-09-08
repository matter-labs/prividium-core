import { subSeconds } from 'date-fns';
import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';
import type { Repositories } from '../db';
import type { PinoLogger } from '../utils/logger';

type Deps = {
    repos: Repositories;
    logger: PinoLogger;
    consumedNonceTtlSeconds: number;
    challengeLogTtlSeconds: number;
    intervalSeconds: number;
};

export function createNonceCleanupJob(deps: Deps): SimpleIntervalJob {
    const logger = deps.logger.child({ role: 'ConsumedNoncesCleanup' });

    const task = new AsyncTask(
        'cleanup-expired-nonces',
        async () => {
            const nonces = await deps.repos.consumedNonces.deleteBefore(
                subSeconds(new Date(), deps.consumedNonceTtlSeconds)
            );
            logger.debug({ deletedCount: nonces }, 'Consumed nonce cleanup completed');
            const challenges = await deps.repos.siweChallengeLogs.deleteBefore(
                subSeconds(new Date(), deps.challengeLogTtlSeconds)
            );
            logger.debug({ deletedCount: challenges }, 'SIWE challenge log cleanup completed');
        },
        (err) => logger.warn({ err }, 'Consumed nonce cleanup failed')
    );

    return new SimpleIntervalJob({ seconds: deps.intervalSeconds }, task, { preventOverrun: true });
}
