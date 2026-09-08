import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';
import type { Repositories } from '../db';
import type { PinoLogger } from '../utils/logger';

type Deps = {
    repos: Repositories;
    logger: PinoLogger;
    intervalSeconds: number;
};

export function createSessionCleanupJob(deps: Deps): SimpleIntervalJob {
    const logger = deps.logger.child({ role: 'SessionCleanup' });

    const task = new AsyncTask(
        'cleanup-expired-or-revoked-sessions',
        async () => {
            const deletedCount = await deps.repos.sessions.deleteExpiredOrRevoked();
            logger.debug({ deletedCount }, 'Session cleanup completed');
        },
        (err) => logger.warn({ err }, 'Session cleanup failed')
    );

    return new SimpleIntervalJob({ seconds: deps.intervalSeconds }, task, { preventOverrun: true });
}
