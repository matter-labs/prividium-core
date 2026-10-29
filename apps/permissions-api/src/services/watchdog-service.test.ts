import { ADMIN_ROLE_ID } from '@repo/access-control';
import type { Address } from 'viem';
import { describe, expect } from 'vitest';
import { Repositories } from '#db/index';
import { userRolesTable } from '#db/schema';
import { type Fixture, it } from '#test/unit-test-context';
import { InvalidInputError } from '#utils/error-types';
import { SessionService } from './session-service';
import { resumeWatchdog, suspendWatchdog, syncWatchdog } from './watchdog-service';

const wallet = '0x1111111111111111111111111111111111111111' as Address;

describe('syncWatchdog', () => {
    it('creates the watchdog with the listed wallets, and nothing for an empty list', async ({ db }: Fixture) => {
        const repos = new Repositories(db);

        await syncWatchdog(repos, []);
        expect(await repos.users.findWatchdog()).toBeUndefined();

        await syncWatchdog(repos, [wallet, wallet]);
        const watchdog = await repos.users.findWatchdog();
        expect(watchdog).toMatchObject({ displayName: 'Watchdog', source: 'watchdog', organization: null });
        expect(watchdog?.wallets.map((w) => w.walletAddress)).toEqual([wallet]);
    });

    it('creates one watchdog when replicas sync at the same time', async ({ db }: Fixture) => {
        const repos = new Repositories(db);

        await Promise.all([syncWatchdog(repos, [wallet]), syncWatchdog(repos, [wallet])]);

        const page = await repos.users.findPaginated({ limit: 10, offset: 0 });
        expect(page.items.filter((user) => user.source === 'watchdog')).toHaveLength(1);
    });

    it('fails, changing nothing, when a listed wallet belongs to another user', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        const holder = await repos.users.create({ displayName: 'Holder', source: 'adminPanel', wallets: [wallet] });

        await expect(syncWatchdog(repos, [wallet])).rejects.toThrow(`a wallet of user ${holder.id}`);

        expect((await repos.users.findById(holder.id))?.wallets.map((w) => w.walletAddress)).toEqual([wallet]);
        expect(await repos.users.findWatchdog()).toBeUndefined();
    });

    it('drops the wallets the list no longer names', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        const next = '0x2222222222222222222222222222222222222222' as Address;

        await syncWatchdog(repos, [wallet]);
        await syncWatchdog(repos, [next]);

        expect((await repos.users.findWatchdog())?.wallets.map((w) => w.walletAddress)).toEqual([next]);
    });

    it('clears any role the watchdog holds', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        await repos.roles.createOrUpdateAdminRole();
        await syncWatchdog(repos, [wallet]);
        const watchdog = await repos.users.findWatchdog();
        await db.insert(userRolesTable).values({ userId: watchdog?.id ?? '', roleId: ADMIN_ROLE_ID });

        await syncWatchdog(repos, [wallet]);

        expect((await repos.users.findWatchdog())?.roles).toEqual([]);
    });
});

describe('suspendWatchdog and resumeWatchdog', () => {
    it('suspends the watchdog, revoking its sessions, and resumes it', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        await syncWatchdog(repos, [wallet]);
        const watchdog = await repos.users.findWatchdog();
        const admin = await repos.users.create({ displayName: 'Admin', source: 'adminPanel' });
        const sessions = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: 3600,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 3600
            }
        });
        await sessions.createRpcSession({ userId: watchdog?.id });

        const suspended = await suspendWatchdog(repos, watchdog?.id ?? '', admin.id);

        expect(suspended.suspendedAt).toBeInstanceOf(Date);
        expect(await repos.sessions.findActiveByUserId(suspended.id)).toEqual([]);

        const resumed = await resumeWatchdog(repos, suspended.id);

        expect(resumed.suspendedAt).toBeNull();
    });

    it('refuses any other user', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        const user = await repos.users.create({ displayName: 'User', source: 'adminPanel' });

        await expect(suspendWatchdog(repos, user.id, user.id)).rejects.toThrow(InvalidInputError);
        await expect(resumeWatchdog(repos, user.id)).rejects.toThrow(InvalidInputError);
    });
});
