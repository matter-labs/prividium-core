import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { sessionsTable, usersTable } from '../db/schema';
import { EntityRepository } from './entity-repository';

const SessionsRepositoryBase = EntityRepository({
    table: sessionsTable,
    idColumn: sessionsTable.id,
    entityName: 'Session',
    defaultOrderBy: [asc(sessionsTable.createdAt), asc(sessionsTable.id)]
});

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;

export class SessionsRepository extends SessionsRepositoryBase {
    async findActiveByTokenHash(tokenHash: string): Promise<Session | undefined> {
        return this.db.query.sessionsTable.findFirst({
            where: and(
                eq(sessionsTable.tokenHash, tokenHash),
                gt(sessionsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
                isNull(sessionsTable.revokedAt)
            )
        });
    }

    async findActiveByUserId(userId: string): Promise<Session[]> {
        return this.findMany({
            filter: and(
                eq(sessionsTable.userId, userId),
                gt(sessionsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
                isNull(sessionsTable.revokedAt)
            ),
            orderBy: [desc(sessionsTable.createdAt)]
        });
    }

    async revokeById(id: number, revokedByUserId: string): Promise<void> {
        await this.update({ revokedBy: revokedByUserId, revokedAt: new Date() }, { filter: eq(sessionsTable.id, id) });
    }

    async revokeAllByUserIdExcept(userId: string, exceptTokenHash: string, revokedByUserId: string): Promise<number> {
        const count = await this.transaction(async (tx) => {
            const revokedBy = revokedByUserId;
            const revokedAt = new Date();
            const result = await tx
                .update(sessionsTable)
                .set({
                    revokedBy,
                    revokedAt
                })
                .where(
                    and(
                        eq(sessionsTable.userId, userId),
                        ne(sessionsTable.tokenHash, exceptTokenHash),
                        isNull(sessionsTable.revokedAt)
                    )
                );
            return result.rowCount ?? 0;
        });
        return count;
    }

    async revokeAllByUserId(userId: string, revokedByUserId: string): Promise<number> {
        const count = await this.transaction(async (tx) => {
            const revokedBy = revokedByUserId;
            const revokedAt = new Date();
            const result = await tx
                .update(sessionsTable)
                .set({
                    revokedBy,
                    revokedAt
                })
                .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)));
            return result.rowCount ?? 0;
        });
        return count;
    }

    async extendByTokenHash(tokenHash: string, newExpiresAt: Date): Promise<Session | undefined> {
        const [updated] = await this.db
            .update(sessionsTable)
            .set({ expiresAt: newExpiresAt })
            .where(
                and(
                    eq(sessionsTable.tokenHash, tokenHash),
                    gt(sessionsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
                    isNull(sessionsTable.revokedAt)
                )
            )
            .returning();
        return updated;
    }

    async revokeAllByOrganizationId(organizationId: string, revokedByUserId: string): Promise<number> {
        return this.transaction(async (tx) => {
            const orgUserIds = tx
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(eq(usersTable.organizationId, organizationId));
            const result = await tx
                .update(sessionsTable)
                .set({ revokedBy: revokedByUserId, revokedAt: new Date() })
                .where(and(inArray(sessionsTable.userId, orgUserIds), isNull(sessionsTable.revokedAt)));
            return result.rowCount ?? 0;
        });
    }

    async deleteByTokenHash(tokenHash: string) {
        return this.delete({ filter: eq(sessionsTable.tokenHash, tokenHash) });
    }

    async deleteExpiredOrRevoked(): Promise<number> {
        const deleted = await this.db
            .delete(sessionsTable)
            .where(or(lt(sessionsTable.expiresAt, new Date()), isNotNull(sessionsTable.revokedAt)))
            .returning({ id: sessionsTable.id });

        return deleted.length;
    }
}
