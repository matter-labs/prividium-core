import type { Address } from 'viem';
import type { Repositories } from '#db/index';
import { UserSources } from '#db/schema';
import type { User } from '#repositories/users-repository';
import { EntityNotFound, InvalidInputError } from '#utils/error-types';

/** Clears the watchdog's roles and gives it exactly the listed wallets; one another user holds fails the boot. */
export async function syncWatchdog(repos: Repositories, wallets: readonly Address[]) {
    const listed = [...new Set(wallets)];
    await repos.transaction(async (tx) => {
        const users = tx.repositories().users;
        await users.lockWatchdogSync();

        for (const wallet of listed) {
            const holder = await users.findByAddress(wallet);
            if (holder !== undefined && holder.source !== UserSources.enum.watchdog) {
                throw new Error(
                    `WATCHDOG_WALLETS lists ${wallet}, a wallet of user ${holder.id}. Remove it from that user first.`
                );
            }
        }

        const watchdog = (await users.findWatchdog()) ?? (listed.length > 0 ? await users.createWatchdog() : undefined);
        if (watchdog !== undefined) {
            await users.clearRoles(watchdog.id);
            await users.setWallets(watchdog.id, listed);
        }
    });
}

export async function suspendWatchdog(repos: Repositories, userId: string, actorId: string): Promise<User> {
    return repos.transaction(async (tx) => {
        const txRepos = tx.repositories();
        const watchdog = await getWatchdog(txRepos, userId);
        if (watchdog.suspendedAt !== null) {
            return watchdog;
        }

        await txRepos.users.setSuspendedAt(userId, new Date());
        await txRepos.sessions.revokeAllByUserId(userId, actorId);
        return getWatchdog(txRepos, userId);
    });
}

export async function resumeWatchdog(repos: Repositories, userId: string): Promise<User> {
    const watchdog = await getWatchdog(repos, userId);
    if (watchdog.suspendedAt === null) {
        return watchdog;
    }

    await repos.users.setSuspendedAt(userId, null);
    return getWatchdog(repos, userId);
}

async function getWatchdog(repos: Repositories, userId: string): Promise<User> {
    const user = await repos.users.findById(userId);
    if (user === undefined) {
        throw new EntityNotFound('User', { id: userId });
    }
    if (user.source !== UserSources.enum.watchdog) {
        throw new InvalidInputError('Only the watchdog user can be suspended');
    }
    return user;
}
