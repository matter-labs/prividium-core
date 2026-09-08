import { subMinutes, subSeconds } from 'date-fns';
import { describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { siweChallengeLogTable } from '../db/schema';
import { SiweChallengeLogRepository } from './siwe-challenge-log-repository';

const ADDRESS = '0x1234567890123456789012345678901234567890' as const;
const OTHER_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;

describe('SiweChallengeLogRepository', () => {
    describe('insert', () => {
        it('inserts a challenge log entry', async ({ db }: Fixture) => {
            const repository = new SiweChallengeLogRepository(db);

            await repository.insert(ADDRESS, 'user');

            const stored = await db.query.siweChallengeLogTable.findFirst({
                where: (f, { eq }) => eq(f.address, ADDRESS)
            });
            expect(stored).toBeDefined();
            expect(stored?.address).toBe(ADDRESS);
            expect(stored?.targetType).toBe('user');
        });

        it('uses tx-bound repositories so inserts roll back with the caller transaction', async ({ db }: Fixture) => {
            const repos = new Repositories(db);

            await expect(
                repos.transaction(async (tx) => {
                    await tx.repositories().siweChallengeLogs.insert(ADDRESS, 'tenant');
                    throw new Error('rollback');
                })
            ).rejects.toThrow('rollback');

            const stored = await db.query.siweChallengeLogTable.findFirst({
                where: (f, { eq }) => eq(f.address, ADDRESS)
            });
            expect(stored).toBeUndefined();
        });
    });

    describe('countSince', () => {
        it('counts only entries for the requested address after the given cutoff', async ({ db }: Fixture) => {
            const repository = new SiweChallengeLogRepository(db);
            const now = new Date();
            const cutoff = subMinutes(now, 5);

            await db.insert(siweChallengeLogTable).values([
                { address: ADDRESS, targetType: 'user', createdAt: subSeconds(now, 60) },
                { address: ADDRESS, targetType: 'tenant', createdAt: subMinutes(now, 2) },
                { address: ADDRESS, targetType: 'service', createdAt: subMinutes(now, 6) },
                { address: OTHER_ADDRESS, targetType: 'user', createdAt: subSeconds(now, 60) }
            ]);

            const recentCount = await repository.countSince(ADDRESS, cutoff);

            expect(recentCount).toBe(2);
        });
    });

    describe('deleteBefore', () => {
        it('removes entries older than the given cutoff', async ({ db }: Fixture) => {
            const repository = new SiweChallengeLogRepository(db);
            const now = new Date();
            const cutoff = subMinutes(now, 10);

            await db.insert(siweChallengeLogTable).values([
                { address: ADDRESS, targetType: 'user', createdAt: subMinutes(now, 11) },
                { address: OTHER_ADDRESS, targetType: 'user', createdAt: subMinutes(now, 5) }
            ]);

            const deleted = await repository.deleteBefore(cutoff);

            expect(deleted).toBe(1);
            const remaining = await db.query.siweChallengeLogTable.findMany();
            expect(remaining).toHaveLength(1);
            expect(remaining[0]?.address.toLowerCase()).toBe(OTHER_ADDRESS.toLowerCase());
        });

        it('returns 0 when no entries are older than the given cutoff', async ({ db }: Fixture) => {
            const repository = new SiweChallengeLogRepository(db);
            const now = new Date();

            await db
                .insert(siweChallengeLogTable)
                .values([{ address: ADDRESS, targetType: 'user', createdAt: subMinutes(now, 5) }]);

            const deleted = await repository.deleteBefore(subMinutes(now, 10));

            expect(deleted).toBe(0);
        });
    });
});
