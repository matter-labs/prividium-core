import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import type { DB } from '../db';

import { passkeyChallengesTable } from '../db/schema';
import { type User, UsersRepository } from '../repositories/users-repository';
import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
    let usersRepository: UsersRepository;
    let testUser: User;
    let testUser2: User;

    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    beforeEach<Fixture>(async ({ db }) => {
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

    /**
     * Creates a challenge record with an optional createdAt offset.
     * Since rateLimit uses PostgreSQL's NOW() directly, we can't use fake timers.
     * Instead, we insert records with createdAt set in the past.
     *
     * @param db - The database instance
     * @param userId - The user ID to associate with the challenge
     * @param secondsAgo - How many seconds in the past to set createdAt (default: 0 = now)
     */
    async function createChallenge(db: DB, userId: string, secondsAgo = 0) {
        const challenge = `challenge-${crypto.randomUUID()}`;
        const now = new Date();
        const createdAt = new Date(now.getTime() - secondsAgo * 1000);
        await db.insert(passkeyChallengesTable).values({
            challenge,
            userId,
            challengeType: 'registration',
            alreadyUsed: false,
            expiresAt: new Date(now.getTime() + FIVE_MINUTES_MS),
            createdAt
        });
        return challenge;
    }

    it('returns rateLimited=false when no records exist', async ({ db }) => {
        const result = await rateLimit({
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });

        expect(result.rateLimited).toBe(false);
    });

    it('returns rateLimited=false when count is below windowCount', async ({ db }) => {
        // Create 3 challenges (below limit of 5)
        for (let i = 0; i < 3; i++) {
            await createChallenge(db, testUser.id);
        }

        const result = await rateLimit({
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });

        expect(result.rateLimited).toBe(false);
    });

    it('returns rateLimited=true when count equals windowCount', async ({ db }) => {
        // Create exactly 5 challenges (equal to limit)
        for (let i = 0; i < 5; i++) {
            await createChallenge(db, testUser.id);
        }

        const result = await rateLimit({
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });

        expect(result.rateLimited).toBe(true);
    });

    it('returns rateLimited=true when count exceeds windowCount', async ({ db }) => {
        // Create 7 challenges (exceeds limit of 5)
        for (let i = 0; i < 7; i++) {
            await createChallenge(db, testUser.id);
        }

        const result = await rateLimit({
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });

        expect(result.rateLimited).toBe(true);
    });

    it('ignores records outside the time window', async ({ db }) => {
        // Create 5 challenges that are older than the 300 second window
        for (let i = 0; i < 5; i++) {
            await createChallenge(db, testUser.id, 301); // 301 seconds ago (outside 300s window)
        }

        const result = await rateLimit({
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });

        // Old records should be outside the window, so not rate limited
        expect(result.rateLimited).toBe(false);
    });

    it('respects additionalFilters parameter', async ({ db }) => {
        // Create 5 challenges for user 1
        for (let i = 0; i < 5; i++) {
            await createChallenge(db, testUser.id);
        }

        // Create 2 challenges for user 2
        for (let i = 0; i < 2; i++) {
            await createChallenge(db, testUser2.id);
        }

        // Rate limit check for user 1 should be true (5 >= 5)
        const result1 = await rateLimit({
            additionalFilters: [eq(passkeyChallengesTable.userId, testUser.id)],
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });
        expect(result1.rateLimited).toBe(true);

        // Rate limit check for user 2 should be false (2 < 5)
        const result2 = await rateLimit({
            additionalFilters: [eq(passkeyChallengesTable.userId, testUser2.id)],
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });
        expect(result2.rateLimited).toBe(false);
    });

    it('combines time window filter with additionalFilters using AND logic', async ({ db }) => {
        // Create 3 old challenges for user 1 (outside the 300 second window)
        for (let i = 0; i < 3; i++) {
            await createChallenge(db, testUser.id, 350); // 350 seconds ago
        }

        // Create 3 recent challenges for user 1 (inside the 300 second window)
        for (let i = 0; i < 3; i++) {
            await createChallenge(db, testUser.id, 100); // 100 seconds ago
        }

        // User 1 should NOT be rate limited (only 3 within window < 5)
        const result1 = await rateLimit({
            additionalFilters: [eq(passkeyChallengesTable.userId, testUser.id)],
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });
        expect(result1.rateLimited).toBe(false);

        // Add 2 more recent challenges for user 1
        for (let i = 0; i < 2; i++) {
            await createChallenge(db, testUser.id, 50); // 50 seconds ago
        }

        // Now user 1 should be rate limited (5 within window >= 5)
        const result2 = await rateLimit({
            additionalFilters: [eq(passkeyChallengesTable.userId, testUser.id)],
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });
        expect(result2.rateLimited).toBe(true);

        // User 2 should not be rate limited (no records)
        const result3 = await rateLimit({
            additionalFilters: [eq(passkeyChallengesTable.userId, testUser2.id)],
            windowCount: 5,
            windowTimeInSeconds: 300,
            tx: db,
            table: passkeyChallengesTable
        });
        expect(result3.rateLimited).toBe(false);
    });
});
