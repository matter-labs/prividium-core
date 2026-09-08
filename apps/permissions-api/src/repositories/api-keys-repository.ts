import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { apiKeysTable, m2mApplicationsTable } from '../db/schema';
import type { PaginationParams } from '../utils/schemas/pagination';
import { EntityRepository } from './entity-repository';

const ApiKeysRepositoryBase = EntityRepository({
    table: apiKeysTable,
    idColumn: apiKeysTable.id,
    entityName: 'ApiKey',
    defaultOrderBy: [asc(apiKeysTable.createdAt), asc(apiKeysTable.id)]
});

export type ApiKey = typeof apiKeysTable.$inferSelect;

export class ApiKeysRepository extends ApiKeysRepositoryBase {
    async findActiveByKeyHash(keyHash: string) {
        // Prepared statement cached per-db-instance. Avoids rebuilding the
        // drizzle relational query AST on every authed request — that AST
        // build accounted for ~45% of permissions-api CPU under sustained
        // load (see issue #1057).
        const stmt = getFindActiveByKeyHashStmt(this.db);
        return stmt.execute({ keyHash });
    }

    async findByTenantId(tenantId: string, paginationParams: PaginationParams) {
        return this.findPaginated(paginationParams, { filter: eq(apiKeysTable.tenantId, tenantId) });
    }

    async findByM2mAppId(m2mAppId: string, paginationParams: PaginationParams) {
        return this.findPaginated(paginationParams, { filter: eq(apiKeysTable.m2mAppId, m2mAppId) });
    }

    async getByIdForTenant(id: string, tenantId: string) {
        return this.getById(id, { filter: eq(apiKeysTable.tenantId, tenantId) });
    }

    async revoke(id: string, tenantId: string) {
        return this.revokeByOwner(id, apiKeysTable.tenantId, tenantId);
    }

    async revokeForM2mApp(id: string, m2mAppId: string) {
        return this.revokeByOwner(id, apiKeysTable.m2mAppId, m2mAppId);
    }

    async revokeAllOwnedByOrganization(organizationId: string): Promise<number> {
        const ownedAppIds = this.db
            .select({ id: m2mApplicationsTable.id })
            .from(m2mApplicationsTable)
            .where(eq(m2mApplicationsTable.ownerOrganizationId, organizationId));

        const result = await this.db
            .update(apiKeysTable)
            .set({ revokedAt: new Date() })
            .where(and(inArray(apiKeysTable.m2mAppId, ownedAppIds), isNull(apiKeysTable.revokedAt)));

        return result.rowCount ?? 0;
    }

    private async revokeByOwner(
        id: string,
        column: typeof apiKeysTable.tenantId | typeof apiKeysTable.m2mAppId,
        ownerId: string
    ) {
        return this.transaction(async (tx) => {
            const txRepo = new ApiKeysRepository(tx);
            const existing = await txRepo.getById(id, { filter: eq(column, ownerId) });

            if (existing.revokedAt) {
                return;
            }

            await txRepo.update({ revokedAt: new Date() }, { filter: eq(apiKeysTable.id, id) });
        });
    }

    async updateLastUsed(id: string, ip: string | null) {
        await this.update({ lastUsedAt: new Date(), lastUsedIp: ip }, { filter: eq(apiKeysTable.id, id) });
    }
}

// Prepared-statement cache for `findActiveByKeyHash`. The relational query is
// hot (called per authed request); preparing it once per db instance avoids
// rebuilding the AST + SQL string on every call. Server-side `now()` is used
// instead of a JS-side `new Date()` so the comparison value also doesn't need
// to be marshalled per call.
const findActiveByKeyHashStmtCache = new WeakMap<DbOrTx, ReturnType<typeof prepareFindActiveByKeyHash>>();

function prepareFindActiveByKeyHash(db: DbOrTx) {
    return db.query.apiKeysTable
        .findFirst({
            where: and(
                eq(apiKeysTable.keyHash, sql.placeholder('keyHash')),
                isNull(apiKeysTable.revokedAt),
                gt(apiKeysTable.expiresAt, sql`now()`)
            )
        })
        .prepare('find_active_api_key_by_key_hash');
}

function getFindActiveByKeyHashStmt(db: DbOrTx) {
    let stmt = findActiveByKeyHashStmtCache.get(db);
    if (!stmt) {
        stmt = prepareFindActiveByKeyHash(db);
        findActiveByKeyHashStmtCache.set(db, stmt);
    }
    return stmt;
}
