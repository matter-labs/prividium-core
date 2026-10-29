import type { ChainType } from '@repo/api-kit';
import { sql } from 'drizzle-orm';
import { deploymentIdentityTable } from '#db/schema';
import { BaseRepository } from './base-repository';

export class DeploymentIdentityRepository extends BaseRepository {
    async insertIfAbsent(chainType: ChainType): Promise<void> {
        await this.db.insert(deploymentIdentityTable).values({ chainType }).onConflictDoNothing();
    }

    /** Undefined on a database the stamp migration has not reached yet, or that no boot has claimed. */
    async find(): Promise<ChainType | undefined> {
        const { rows } = await this.db.execute<{ exists: boolean }>(
            sql`SELECT to_regclass('deployment_identity') IS NOT NULL AS exists`
        );
        if (rows[0]?.exists !== true) {
            return undefined;
        }
        const row = await this.db.query.deploymentIdentityTable.findFirst({ columns: { chainType: true } });
        return row?.chainType;
    }
}
