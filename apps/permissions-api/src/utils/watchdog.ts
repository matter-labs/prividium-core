import { type UserSource, UserSources } from '#db/schema';
import { InvalidInputError } from './error-types';

export function isWatchdog(user: { source: UserSource }): boolean {
    return user.source === UserSources.enum.watchdog;
}

export function assertNotWatchdog(user: { source: UserSource }): void {
    if (isWatchdog(user)) {
        throw new InvalidInputError('The watchdog user is managed by deploy config');
    }
}
