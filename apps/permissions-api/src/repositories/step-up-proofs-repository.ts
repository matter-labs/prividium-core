import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { stepUpProofsTable } from '../db/schema';
import { EntityRepository } from './entity-repository';

const StepUpProofsRepositoryBase = EntityRepository({
    table: stepUpProofsTable,
    idColumn: stepUpProofsTable.id,
    entityName: 'StepUpProof',
    defaultOrderBy: [asc(stepUpProofsTable.createdAt), asc(stepUpProofsTable.id)]
});

export type StepUpProof = typeof stepUpProofsTable.$inferSelect;

export class StepUpProofsRepository extends StepUpProofsRepositoryBase {
    async findByProofHash(proofHash: string): Promise<StepUpProof | undefined> {
        return this.findOne({ filter: eq(stepUpProofsTable.proofHash, proofHash) });
    }

    /**
     * Atomic single-use consume. Succeeds only if the proof exists, matches the
     * expected session/user/action, has not been consumed, and has not expired —
     * all checked inside one UPDATE to close TOCTOU races.
     */
    async consume(criteria: {
        proofHash: string;
        sessionTokenHash: string;
        userId: string;
        action: string;
    }): Promise<StepUpProof | undefined> {
        const [consumed] = await this.db
            .update(stepUpProofsTable)
            .set({ consumedAt: sql`NOW()` })
            .where(
                and(
                    eq(stepUpProofsTable.proofHash, criteria.proofHash),
                    eq(stepUpProofsTable.sessionTokenHash, criteria.sessionTokenHash),
                    eq(stepUpProofsTable.userId, criteria.userId),
                    eq(stepUpProofsTable.action, criteria.action),
                    isNull(stepUpProofsTable.consumedAt),
                    gt(stepUpProofsTable.expiresAt, sql`NOW()`)
                )
            )
            .returning();

        return consumed;
    }

    async deleteExpired(opts?: { graceMs?: number }): Promise<number> {
        const cutoff = new Date(Date.now() - (opts?.graceMs ?? 0));
        const deleted = await this.delete({ filter: lt(stepUpProofsTable.expiresAt, cutoff) });
        return deleted.length;
    }
}
