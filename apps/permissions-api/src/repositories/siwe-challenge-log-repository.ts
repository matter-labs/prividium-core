import { and, count, eq, gt, lt } from 'drizzle-orm';
import type { Address } from 'viem';
import { siweChallengeLogTable, type TargetType } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { BaseRepository } from './base-repository';

export class SiweChallengeLogRepository extends BaseRepository {
    async insert(address: Address, targetType: TargetType): Promise<void> {
        await this.db.insert(siweChallengeLogTable).values({ address, targetType });
    }

    async countSince(address: Address, since: Date): Promise<number> {
        return this.db
            .select({ count: count() })
            .from(siweChallengeLogTable)
            .where(and(eq(siweChallengeLogTable.address, address), gt(siweChallengeLogTable.createdAt, since)))
            .then(getFirstOrThrow)
            .then((result) => result.count);
    }

    async deleteBefore(createdBefore: Date): Promise<number> {
        const deleted = await this.db
            .delete(siweChallengeLogTable)
            .where(lt(siweChallengeLogTable.createdAt, createdBefore))
            .returning({ id: siweChallengeLogTable.id });

        return deleted.length;
    }
}
