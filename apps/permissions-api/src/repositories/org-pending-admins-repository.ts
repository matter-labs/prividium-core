import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { organizationsTable, orgPendingAdminsTable } from '../db/schema';
import { EntityNotFound } from '../utils/error-types';
import { EntityRepository } from './entity-repository';

const OrgPendingAdminsRepositoryBase = EntityRepository({
    table: orgPendingAdminsTable,
    idColumn: orgPendingAdminsTable.id,
    entityName: 'Pending admin',
    defaultOrderBy: [asc(orgPendingAdminsTable.createdAt), asc(orgPendingAdminsTable.id)]
});

export type OrgPendingAdmin = typeof orgPendingAdminsTable.$inferSelect;

export class OrgPendingAdminsRepository extends OrgPendingAdminsRepositoryBase {
    async findByOrganization(organizationId: string): Promise<OrgPendingAdmin[]> {
        return this.findMany({ filter: eq(orgPendingAdminsTable.organizationId, organizationId) });
    }

    async findByOrganizationAndSub(organizationId: string, oidcSub: string): Promise<OrgPendingAdmin | undefined> {
        return this.findOne({
            filter: and(
                eq(orgPendingAdminsTable.organizationId, organizationId),
                eq(orgPendingAdminsTable.oidcSub, oidcSub),
                // Second lock: unreachable today, since the OIDC issuer lookup already filters.
                inArray(
                    orgPendingAdminsTable.organizationId,
                    this.db
                        .select({ id: organizationsTable.id })
                        .from(organizationsTable)
                        .where(isNull(organizationsTable.deletedAt))
                )
            )
        });
    }

    async deleteByOrganizationAndSub(organizationId: string, oidcSub: string): Promise<void> {
        const deleted = await this.delete({
            filter: and(
                eq(orgPendingAdminsTable.organizationId, organizationId),
                eq(orgPendingAdminsTable.oidcSub, oidcSub)
            )
        });
        if (deleted.length === 0) {
            throw new EntityNotFound('Pending admin', { organizationId, oidcSub });
        }
    }
}
