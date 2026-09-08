import * as Sentry from '@sentry/node';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PinoLogger } from '../utils/logger';
import type { DB } from '.';

/**
 * `migrationsFolder` resolves against the working directory, so a composition root
 * booting from elsewhere has to name it.
 */
export async function runMigrations(db: DB, logger: PinoLogger, migrationsFolder = './drizzle'): Promise<void> {
    try {
        logger.info('Running database migrations...');
        await migrate(db, { migrationsFolder });
        logger.info('Database migrations completed successfully');
    } catch (error) {
        logger.error(error, 'Migration failed');
        Sentry.captureException(error, {
            tags: {
                service: 'permissions-api',
                component: 'database-migration'
            }
        });
        throw error;
    }
}
