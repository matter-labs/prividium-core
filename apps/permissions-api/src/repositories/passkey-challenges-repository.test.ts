import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { passkeyChallengesTable } from '../db/schema';
import { EntityNotFound, RateLimitError } from '../utils/error-types';
import { PasskeyChallengesRepository } from './passkey-challenges-repository';
import { type User, UsersRepository } from './users-repository';

describe('PasskeyChallengesRepository', () => {
    let repository: PasskeyChallengesRepository;
    let usersRepository: UsersRepository;
    let testUser: User;
    let testUser2: User;

    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new PasskeyChallengesRepository(db);
        usersRepository = new UsersRepository(db);

        // Create test users
        testUser = await usersRepository.create({
            displayName: 'Test User',
            source: 'adminPanel'
        });

        testUser2 = await usersRepository.create({
            displayName: 'Test User 2',
            source: 'adminPanel'
        });
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('create', () => {
        it('creates a registration challenge', async () => {
            const now = new Date();
            vi.setSystemTime(now);

            const challenge = await repository.create(testUser.id, 'registration');

            expect(challenge.challenge).toBeDefined();
            expect(challenge.challenge).toHaveLength(32);
            expect(challenge.userId).toBe(testUser.id);
            expect(challenge.challengeType).toBe('registration');
            expect(challenge.alreadyUsed).toBe(false);
            expect(challenge.expiresAt).toEqual(new Date(now.getTime() + FIVE_MINUTES_MS));
            expect(challenge.createdAt).toBeDefined();
            expect(challenge.updatedAt).toBeDefined();
        });

        it('creates an authentication challenge', async () => {
            const challenge = await repository.create(testUser.id, 'authentication');

            expect(challenge.challengeType).toBe('authentication');
            expect(challenge.alreadyUsed).toBe(false);
        });

        it('creates unique challenges each time', async () => {
            const challenge1 = await repository.create(testUser.id, 'registration');
            const challenge2 = await repository.create(testUser.id, 'registration');

            expect(challenge1.challenge).not.toBe(challenge2.challenge);
        });

        it('uses custom expiration time', async () => {
            const customExpirationMs = 10 * 60 * 1000; // 10 minutes

            const now = new Date();
            vi.setSystemTime(now);

            const challenge = await repository.create(testUser.id, 'registration', {
                expirationDeltaMs: customExpirationMs
            });

            expect(challenge.expiresAt).toEqual(new Date(now.getTime() + customExpirationMs));
        });
    });

    describe('findByChallenge', () => {
        it('returns challenge when found', async () => {
            const created = await repository.create(testUser.id, 'registration');

            const found = await repository.findByChallenge(created.challenge);

            expect(found).toBeDefined();
            expect(found?.challenge).toBe(created.challenge);
            expect(found?.userId).toBe(testUser.id);
            expect(found?.challengeType).toBe('registration');
        });

        it('returns undefined when challenge not found', async () => {
            const found = await repository.findByChallenge('non-existent-challenge');
            expect(found).toBeUndefined();
        });

        it('finds challenge that has been marked as used', async () => {
            const created = await repository.create(testUser.id, 'authentication');
            await repository.markAsUsed(created.challenge);

            const found = await repository.findByChallenge(created.challenge);

            expect(found).toBeDefined();
            expect(found?.alreadyUsed).toBe(true);
        });
    });

    describe('markAsUsed', () => {
        it('sets alreadyUsed flag to true', async () => {
            const created = await repository.create(testUser.id, 'registration');
            expect(created.alreadyUsed).toBe(false);

            const updated = await repository.markAsUsed(created.challenge);

            expect(updated.alreadyUsed).toBe(true);

            // Verify persistence
            const found = await repository.findByChallenge(created.challenge);
            expect(found?.alreadyUsed).toBe(true);
        });

        it('throws EntityNotFound when challenge does not exist', async () => {
            await expect(repository.markAsUsed('non-existent-challenge')).rejects.toThrow(
                new EntityNotFound('PasskeyChallenge', { challenge: 'non-existent-challenge' })
            );
        });

        it('rolls back markAsUsed when transaction fails', async ({ db }) => {
            const created = await repository.create(testUser.id, 'authentication');
            expect(created.alreadyUsed).toBe(false);

            // Mark as used within a transaction that will fail
            await expect(
                db.repositories().transaction(async (tx) => {
                    await tx.repositories().passkeyChallenges.markAsUsed(created.challenge);

                    // Verify it's marked as used within the transaction
                    const withinTx = await tx.repositories().passkeyChallenges.findByChallenge(created.challenge);
                    expect(withinTx?.alreadyUsed).toBe(true);

                    // Force transaction to rollback
                    throw new Error('Simulated failure');
                })
            ).rejects.toThrow('Simulated failure');

            // Verify the challenge is NOT marked as used after rollback
            const found = await repository.findByChallenge(created.challenge);
            expect(found?.alreadyUsed).toBe(false);
        });

        it('rejects concurrent markAsUsed on the same challenge', async () => {
            const created = await repository.create(testUser.id, 'authentication');

            const [resA, resB] = await Promise.allSettled([
                repository.markAsUsed(created.challenge),
                repository.markAsUsed(created.challenge)
            ]);

            const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
            const rejected = [resA, resB].filter((r) => r.status === 'rejected');

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EntityNotFound);

            const found = await repository.findByChallenge(created.challenge);
            expect(found?.alreadyUsed).toBe(true);
        });
    });

    describe('deleteExpired', () => {
        it('removes expired challenges', async () => {
            const now = new Date();
            vi.setSystemTime(now);

            // Create challenges that will expire at different times
            const challenge1 = await repository.create(testUser.id, 'registration');
            const challenge2 = await repository.create(testUser.id, 'authentication');

            // Move time forward past expiration
            vi.setSystemTime(new Date(now.getTime() + FIVE_MINUTES_MS + 1000));

            const deletedCount = await repository.deleteExpired();

            expect(deletedCount).toBe(2);

            // Verify they're gone
            expect(await repository.findByChallenge(challenge1.challenge)).toBeUndefined();
            expect(await repository.findByChallenge(challenge2.challenge)).toBeUndefined();
        });

        it('does not remove non-expired challenges', async () => {
            const now = new Date();
            vi.setSystemTime(now);

            const challenge = await repository.create(testUser.id, 'registration');

            // Move time forward but not past expiration
            vi.setSystemTime(new Date(now.getTime() + FIVE_MINUTES_MS - 1000));

            const deletedCount = await repository.deleteExpired();

            expect(deletedCount).toBe(0);

            // Verify it still exists
            const found = await repository.findByChallenge(challenge.challenge);
            expect(found).toBeDefined();
        });

        it('returns 0 when no challenges exist', async () => {
            const deletedCount = await repository.deleteExpired();
            expect(deletedCount).toBe(0);
        });
    });

    describe('rate limiting', () => {
        it('allows up to 10 challenges in 5 minutes', async () => {
            // Create 10 challenges - should all succeed
            for (let i = 0; i < 10; i++) {
                await repository.create(testUser.id, 'registration');
            }

            // 11th should fail
            await expect(repository.create(testUser.id, 'registration')).rejects.toThrow(RateLimitError);
        });

        it('throws RateLimitError with appropriate message', async () => {
            for (let i = 0; i < 10; i++) {
                await repository.create(testUser.id, 'registration');
            }

            await expect(repository.create(testUser.id, 'registration')).rejects.toThrow(
                'Too many passkey challenges requested. Please wait a moment before continuing.'
            );
        });

        it('rate limits users independently', async () => {
            // Create 10 challenges for user 1
            for (let i = 0; i < 10; i++) {
                await repository.create(testUser.id, 'registration');
            }

            // User 2 should still be able to create challenges
            const challenge = await repository.create(testUser2.id, 'registration');
            expect(challenge).toBeDefined();
        });

        it('allows more challenges after rate limit window expires', async ({ db }) => {
            const sevenMinutesAgo = new Date(Date.now() - 7 * 60 * 1000);

            // Create 10 challenges with old timestamps
            for (let i = 0; i < 10; i++) {
                await db.insert(passkeyChallengesTable).values({
                    challenge: `test-challenge-${i}`,
                    challengeType: 'authentication',
                    expiresAt: new Date(),
                    userId: testUser.id,
                    alreadyUsed: false,
                    createdAt: sevenMinutesAgo,
                    updatedAt: sevenMinutesAgo
                });
            }

            // Should be able to create challenges after window
            for (let i = 0; i < 10; i++) {
                const challenge = await repository.create(testUser.id, 'authentication');
                expect(challenge).toBeDefined();
            }
        });

        it('does not count used challenges toward rate limit', async () => {
            // Create 5 challenges and mark them as used
            for (let i = 0; i < 5; i++) {
                const challenge = await repository.create(testUser.id, 'registration');
                await repository.markAsUsed(challenge.challenge);
            }

            // Should still be able to create 10 more unused challenges
            for (let i = 0; i < 10; i++) {
                const challenge = await repository.create(testUser.id, 'registration');
                expect(challenge).toBeDefined();
            }

            // 11th unused challenge should fail
            await expect(repository.create(testUser.id, 'registration')).rejects.toThrow(RateLimitError);
        });

        it('counts both registration and authentication challenges toward limit', async () => {
            // Create 5 registration challenges
            for (let i = 0; i < 5; i++) {
                await repository.create(testUser.id, 'registration');
            }

            // Create 5 authentication challenges
            for (let i = 0; i < 5; i++) {
                await repository.create(testUser.id, 'authentication');
            }

            // 11th challenge of either type should fail
            await expect(repository.create(testUser.id, 'registration')).rejects.toThrow(RateLimitError);
            await expect(repository.create(testUser.id, 'authentication')).rejects.toThrow(RateLimitError);
        });
    });

    describe('cascade delete', () => {
        it('deletes challenges when user is deleted', async () => {
            const challenge = await repository.create(testUser.id, 'registration');

            // Delete the user
            await usersRepository.delete(testUser.id);

            // Challenge should be deleted due to cascade
            const found = await repository.findByChallenge(challenge.challenge);
            expect(found).toBeUndefined();
        });
    });
});
