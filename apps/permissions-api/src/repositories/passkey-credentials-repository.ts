import { asc, count, desc, eq } from 'drizzle-orm';
import { passkeyCredentialsTable } from '../db/schema';
import { EntityRepository } from './entity-repository';

const PasskeyCredentialsRepositoryBase = EntityRepository({
    table: passkeyCredentialsTable,
    idColumn: passkeyCredentialsTable.id,
    entityName: 'PasskeyCredential',
    defaultOrderBy: [asc(passkeyCredentialsTable.createdAt), asc(passkeyCredentialsTable.id)]
});

export type PasskeyCredential = typeof passkeyCredentialsTable.$inferSelect;
export type InsertPasskeyCredential = typeof passkeyCredentialsTable.$inferInsert;
export type UpdatePasskeyCredential = Partial<InsertPasskeyCredential>;

export class PasskeyCredentialsRepository extends PasskeyCredentialsRepositoryBase {
    async findByCredentialId(credentialId: string): Promise<PasskeyCredential | undefined> {
        return this.findOne({ filter: eq(passkeyCredentialsTable.credentialId, credentialId) });
    }

    async findByUserId(userId: string): Promise<PasskeyCredential[]> {
        return this.findMany({
            filter: eq(passkeyCredentialsTable.userId, userId),
            orderBy: [desc(passkeyCredentialsTable.createdAt)]
        });
    }

    async countByUserId(userId: string): Promise<number> {
        const [result] = await this.db
            .select({ count: count() })
            .from(passkeyCredentialsTable)
            .where(eq(passkeyCredentialsTable.userId, userId));

        return result?.count ?? 0;
    }

    async deleteIfNotLast(id: string, userId: string): Promise<'deleted' | 'last' | 'not_found'> {
        return this.transaction(async (tx) => {
            const rows = await tx
                .select({ id: passkeyCredentialsTable.id })
                .from(passkeyCredentialsTable)
                .where(eq(passkeyCredentialsTable.userId, userId))
                .orderBy(passkeyCredentialsTable.id)
                .for('update');

            const target = rows.find((r) => r.id === id);
            if (target === undefined) {
                return 'not_found';
            }
            if (rows.length <= 1) {
                return 'last';
            }

            await tx.delete(passkeyCredentialsTable).where(eq(passkeyCredentialsTable.id, id));

            return 'deleted';
        });
    }

    async deleteAllByUserId(userId: string): Promise<number> {
        const deleted = await this.delete({ filter: eq(passkeyCredentialsTable.userId, userId) });
        return deleted.length;
    }
}
