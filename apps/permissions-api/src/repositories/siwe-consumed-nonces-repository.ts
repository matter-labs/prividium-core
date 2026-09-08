import { lt } from 'drizzle-orm';
import { siweConsumedNoncesTable } from '../db/schema';
import { BaseRepository } from './base-repository';

export class SiweConsumedNoncesRepository extends BaseRepository {
    async insertHash(nonceHash: string): Promise<boolean> {
        const inserted = await this.db
            .insert(siweConsumedNoncesTable)
            .values({ nonceHash })
            .onConflictDoNothing()
            .returning({ nonceHash: siweConsumedNoncesTable.nonceHash });

        return inserted.length > 0;
    }

    async deleteBefore(consumedBefore: Date): Promise<number> {
        const deleted = await this.db
            .delete(siweConsumedNoncesTable)
            .where(lt(siweConsumedNoncesTable.consumedAt, consumedBefore))
            .returning({ nonceHash: siweConsumedNoncesTable.nonceHash });

        return deleted.length;
    }
}
