import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { z } from 'zod/v4';
import { type PasskeyChallengeTypes, passkeyChallengesTable } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { secureRandomString } from '../utils/crypto';
import { createInsertSchema, createSelectSchema } from '../utils/drizzle-zod-schema-factory';
import { EntityNotFound, RateLimitError } from '../utils/error-types';
import { rateLimit } from '../utils/rate-limit';
import { BaseRepository } from './base-repository';

export const CreatePasskeyChallengeSchema = createInsertSchema(passkeyChallengesTable).omit({
    createdAt: true,
    updatedAt: true,
    alreadyUsed: true
});

export const SelectPasskeyChallengeSchema = createSelectSchema(passkeyChallengesTable);

export type PasskeyChallenge = z.infer<typeof SelectPasskeyChallengeSchema>;
export type PasskeyChallengeType = z.infer<typeof PasskeyChallengeTypes>;

const DEFAULT_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

export class PasskeyChallengesRepository extends BaseRepository {
    async create(
        userId: string,
        challengeType: PasskeyChallengeType,
        opts: { linkedSiweNonce?: string; linkedAction?: string; expirationDeltaMs?: number } = {}
    ): Promise<PasskeyChallenge> {
        const expirationDeltaMs = opts.expirationDeltaMs ?? DEFAULT_EXPIRATION_MS;
        return this.transaction(async (tx) => {
            await tx.repositories().passkeyChallenges.rateLimit(userId);

            const challenge = secureRandomString(32);
            const expiresAt = new Date(Date.now() + expirationDeltaMs);

            return tx
                .insert(passkeyChallengesTable)
                .values({
                    challenge,
                    userId,
                    challengeType,
                    expiresAt,
                    linkedSiweNonce: opts.linkedSiweNonce,
                    linkedAction: opts.linkedAction
                })
                .returning()
                .then(getFirstOrThrow);
        });
    }

    async findByChallenge(challenge: string): Promise<PasskeyChallenge | undefined> {
        return this.db.query.passkeyChallengesTable.findFirst({
            where: (rows, { eq }) => eq(rows.challenge, challenge)
        });
    }

    async markAsUsed(challenge: string): Promise<PasskeyChallenge> {
        const [updated] = await this.db
            .update(passkeyChallengesTable)
            .set({ alreadyUsed: true })
            .where(
                and(
                    eq(passkeyChallengesTable.challenge, challenge),
                    eq(passkeyChallengesTable.alreadyUsed, false),
                    gt(passkeyChallengesTable.expiresAt, sql`NOW()`)
                )
            )
            .returning();

        if (updated === undefined) {
            throw new EntityNotFound('PasskeyChallenge', { challenge });
        }

        return updated;
    }

    async markAllPendingAsUsed(userId: string, challengeType: PasskeyChallengeType): Promise<number> {
        const result = await this.db
            .update(passkeyChallengesTable)
            .set({ alreadyUsed: true })
            .where(
                and(
                    eq(passkeyChallengesTable.userId, userId),
                    eq(passkeyChallengesTable.challengeType, challengeType),
                    eq(passkeyChallengesTable.alreadyUsed, false),
                    gt(passkeyChallengesTable.expiresAt, sql`NOW()`)
                )
            );
        return result.rowCount ?? 0;
    }

    async deleteExpired(opts?: { graceMs?: number }): Promise<number> {
        const cutoff = new Date(Date.now() - (opts?.graceMs ?? 0));
        const deleted = await this.db
            .delete(passkeyChallengesTable)
            .where(lt(passkeyChallengesTable.expiresAt, cutoff))
            .returning();

        return deleted.length;
    }

    private async rateLimit(userId: string): Promise<void> {
        const { rateLimited } = await rateLimit({
            tx: this.db,
            table: passkeyChallengesTable,
            windowCount: 10,
            windowTimeInSeconds: 5 * 60,
            additionalFilters: [
                eq(passkeyChallengesTable.userId, userId),
                eq(passkeyChallengesTable.alreadyUsed, false)
            ]
        });
        if (rateLimited) {
            throw new RateLimitError('Too many passkey challenges requested. Please wait a moment before continuing.');
        }
    }
}
