import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';
import type { Repositories } from '../db';
import type { PinoLogger } from '../utils/logger';

// Buffer against in-flight verifies and modest app/DB clock skew.
const GRACE_MS = 60_000;

type Deps = {
    repos: Repositories;
    logger: PinoLogger;
    intervalSeconds: number;
};

export function createAuthRecordsCleanupJob(deps: Deps): SimpleIntervalJob {
    const logger = deps.logger.child({ role: 'AuthRecordsCleanup' });

    const task = new AsyncTask(
        'cleanup-expired-auth-records',
        async () => {
            const [stepUpResult, challengeResult] = await Promise.allSettled([
                deps.repos.stepUpProofs.deleteExpired({ graceMs: GRACE_MS }),
                deps.repos.passkeyChallenges.deleteExpired({ graceMs: GRACE_MS })
            ]);

            if (stepUpResult.status === 'fulfilled') {
                logger.debug({ deletedCount: stepUpResult.value }, 'Step-up proof cleanup completed');
            } else {
                logger.warn({ err: stepUpResult.reason }, 'Step-up proof cleanup failed');
            }

            if (challengeResult.status === 'fulfilled') {
                logger.debug({ deletedCount: challengeResult.value }, 'Passkey challenge cleanup completed');
            } else {
                logger.warn({ err: challengeResult.reason }, 'Passkey challenge cleanup failed');
            }
        },
        (err) => logger.warn({ err }, 'Auth records cleanup failed')
    );

    return new SimpleIntervalJob({ seconds: deps.intervalSeconds }, task, { preventOverrun: true });
}
