import { subMinutes } from 'date-fns';
import { describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { siweConsumedNoncesTable } from '../db/schema';
import { SiweConsumedNoncesRepository } from './siwe-consumed-nonces-repository';

const NONCE_HASH = 'a'.repeat(64);
const OTHER_NONCE_HASH = 'b'.repeat(64);

describe('SiweConsumedNoncesRepository', () => {
    describe('insertHash', () => {
        it('returns true when a nonce hash is inserted for the first time', async ({ db }: Fixture) => {
            const repository = new SiweConsumedNoncesRepository(db);

            const consumed = await repository.insertHash(NONCE_HASH);

            expect(consumed).toBe(true);
            const stored = await db.query.siweConsumedNoncesTable.findFirst({
                where: (f, { eq }) => eq(f.nonceHash, NONCE_HASH)
            });
            expect(stored).toBeDefined();
        });

        it('returns false when the nonce hash already exists', async ({ db }: Fixture) => {
            const repository = new SiweConsumedNoncesRepository(db);

            expect(await repository.insertHash(NONCE_HASH)).toBe(true);
            expect(await repository.insertHash(NONCE_HASH)).toBe(false);
        });

        it('allows exactly one of concurrent insertHash calls to succeed', async ({ db }: Fixture) => {
            const repository = new SiweConsumedNoncesRepository(db);

            const results = await Promise.all([
                repository.insertHash(NONCE_HASH),
                repository.insertHash(NONCE_HASH),
                repository.insertHash(NONCE_HASH)
            ]);

            expect(results.filter(Boolean)).toHaveLength(1);
            expect(results.filter((r) => !r)).toHaveLength(2);
        });

        it('uses tx-bound repositories so inserts roll back with the caller transaction', async ({ db }: Fixture) => {
            const repos = new Repositories(db);

            await expect(
                repos.transaction(async (tx) => {
                    await tx.repositories().consumedNonces.insertHash(NONCE_HASH);
                    throw new Error('rollback');
                })
            ).rejects.toThrow('rollback');

            const stored = await db.query.siweConsumedNoncesTable.findFirst({
                where: (f, { eq }) => eq(f.nonceHash, NONCE_HASH)
            });
            expect(stored).toBeUndefined();
        });
    });

    describe('deleteBefore', () => {
        it('removes entries older than the given cutoff', async ({ db }: Fixture) => {
            const repository = new SiweConsumedNoncesRepository(db);
            const now = new Date();
            const cutoff = subMinutes(now, 10);

            await db.insert(siweConsumedNoncesTable).values([
                {
                    nonceHash: NONCE_HASH,
                    consumedAt: subMinutes(now, 11)
                },
                {
                    nonceHash: OTHER_NONCE_HASH,
                    consumedAt: subMinutes(now, 5)
                }
            ]);

            const deleted = await repository.deleteBefore(cutoff);

            expect(deleted).toBe(1);
            expect(
                await db.query.siweConsumedNoncesTable.findFirst({
                    where: (f, { eq }) => eq(f.nonceHash, NONCE_HASH)
                })
            ).toBeUndefined();
            expect(
                await db.query.siweConsumedNoncesTable.findFirst({
                    where: (f, { eq }) => eq(f.nonceHash, OTHER_NONCE_HASH)
                })
            ).toBeDefined();
        });

        it('returns 0 when no entries are older than the given cutoff', async ({ db }: Fixture) => {
            const repository = new SiweConsumedNoncesRepository(db);
            const now = new Date();

            await db.insert(siweConsumedNoncesTable).values([
                {
                    nonceHash: NONCE_HASH,
                    consumedAt: subMinutes(now, 5)
                }
            ]);

            const deleted = await repository.deleteBefore(subMinutes(now, 10));

            expect(deleted).toBe(0);
        });
    });
});
