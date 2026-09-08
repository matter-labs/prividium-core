import { and, asc, eq, isNull } from 'drizzle-orm';
import { isUniqueConstraintError } from '../db/errors';
import { oidcProvidersTable, organizationsTable } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { EntityAlreadyExistsError } from '../utils/error-types';
import { EntityRepository } from './entity-repository';

const OidcProvidersRepositoryBase = EntityRepository({
    table: oidcProvidersTable,
    idColumn: oidcProvidersTable.organizationId,
    entityName: 'OidcProvider',
    defaultOrderBy: [asc(oidcProvidersTable.createdAt), asc(oidcProvidersTable.organizationId)]
});

export type OidcProvider = typeof oidcProvidersTable.$inferSelect;

type InsertOidcProvider = typeof oidcProvidersTable.$inferInsert;

export class OidcProvidersRepository extends OidcProvidersRepositoryBase {
    // Excludes providers whose organization is soft-deleted, so a deleted org's IdP stops resolving (and
    // therefore stops authenticating) even though the row survives the soft delete.
    async getByIssuer(issuer: string): Promise<OidcProvider | undefined> {
        const [row] = await this.db
            .select({ provider: oidcProvidersTable })
            .from(oidcProvidersTable)
            .innerJoin(organizationsTable, eq(oidcProvidersTable.organizationId, organizationsTable.id))
            .where(and(eq(oidcProvidersTable.issuer, issuer), isNull(organizationsTable.deletedAt)))
            .limit(1);
        return row?.provider;
    }

    async upsert(data: InsertOidcProvider): Promise<OidcProvider> {
        try {
            const { organizationId, ...rest } = data;
            return await this.db
                .insert(oidcProvidersTable)
                .values(data)
                .onConflictDoUpdate({
                    target: oidcProvidersTable.organizationId,
                    set: { ...rest }
                })
                .returning()
                .then(getFirstOrThrow);
        } catch (err) {
            if (isUniqueConstraintError(err)) {
                throw new EntityAlreadyExistsError('OIDC provider issuer is already in use by another organization');
            }
            throw err;
        }
    }
}
