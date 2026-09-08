import { and, asc, count, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { Address } from 'viem';
import type { TxType } from '../db';
import {
    m2mApplicationsOrganizationsTable,
    m2mApplicationsTable,
    m2mAppRolesTable,
    organizationsTable,
    rolesTable,
    usersTable,
    walletsTable
} from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { permissionsOutsideOrgCeiling } from '../permissions/system-permissions';
import { hasOverbroadIp } from '../utils/cidr';
import { EntityNotFound, InvalidInputError } from '../utils/error-types';
import { fetchChunked } from '../utils/fetch-chunked';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';
import type { Role } from './roles-repository';
import type { User, UserWithRoles } from './users-repository';

export type M2mApplicationOrganization = Pick<typeof organizationsTable.$inferSelect, 'id'>;
export type M2mSelectedOrganization = Pick<typeof organizationsTable.$inferSelect, 'id' | 'name'>;

export type M2mApplication = typeof m2mApplicationsTable.$inferSelect & {
    roles: Role[];
    organizations: M2mApplicationOrganization[];
    hasOverbroadIpWhitelist: boolean;
};

export type InsertM2mApplication = typeof m2mApplicationsTable.$inferInsert & {
    roles: Pick<Role, 'id'>[];
    organizationIds?: string[];
};

export type UpdateM2mApplication = Omit<InsertM2mApplication, 'organizationIds'>;

// Org-scoped create: ownership is bound from the route path, never the body, and the credential
// cannot be assigned to other organizations (no organizationIds).
export type CreateOrgM2mApplication = { name: string; description?: string | null; roles: Pick<Role, 'id'>[] };
// Update carries the same mutable fields; aliased for intent at the call site (mirrors UpdateM2mApplication).
export type UpdateOrgM2mApplication = CreateOrgM2mApplication;

const M2M_APP_RELATIONS = {
    organizations: {
        columns: {
            organizationId: true
        }
    },
    roles: {
        with: {
            role: true
        }
    },
    ipWhitelist: {
        columns: {
            ipAddress: true
        }
    }
} as const;

type M2mApplicationRow = typeof m2mApplicationsTable.$inferSelect & {
    organizations: { organizationId: string }[];
    roles: { role: Role }[];
    ipWhitelist: { ipAddress: string }[];
};

function toM2mApplication({ ipWhitelist, organizations, roles, ...rest }: M2mApplicationRow): M2mApplication {
    return {
        ...rest,
        organizations: organizations.map((o) => ({ id: o.organizationId })),
        roles: roles.map(({ role }) => role),
        hasOverbroadIpWhitelist: hasOverbroadIp(ipWhitelist)
    };
}

// Assignment rows survive an org's soft delete, so joins through them must drop deleted orgs.
const liveAssignedOrganization = and(
    eq(organizationsTable.id, m2mApplicationsOrganizationsTable.organizationId),
    isNull(organizationsTable.deletedAt)
);

export class M2mApplicationsRepository extends BaseRepository {
    async create(data: InsertM2mApplication): Promise<M2mApplication> {
        const { roles, organizationIds, ...m2mAppFields } = data;

        return this.transaction(async (tx) => {
            const created = await tx
                .insert(m2mApplicationsTable)
                .values(m2mAppFields)
                .returning()
                .then(getFirstOrThrow);

            const associatedRoles = await this.associateRoles(roles, created.id, tx);

            const orgs =
                organizationIds && organizationIds.length > 0
                    ? await this.linkOrganizations(created.id, organizationIds, tx)
                    : [];

            return {
                ...created,
                roles: associatedRoles,
                organizations: orgs,
                hasOverbroadIpWhitelist: false
            };
        });
    }

    async searchPaginated({ limit, offset }: PaginationParams): Promise<PaginatedResult<M2mApplication>> {
        const { count: countResult } = await this.db
            .select({ count: count() })
            .from(m2mApplicationsTable)
            .then(getFirstOrThrow);

        const items = await this.db.query.m2mApplicationsTable.findMany({
            limit,
            offset,
            orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
            with: M2M_APP_RELATIONS
        });

        return {
            items: items.map(toM2mApplication),
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(countResult / limit),
                totalItems: countResult,
                limit,
                offset
            }
        };
    }

    // The `isNull` guard keeps an org-owned credential with a stray peer junction row out of that peer's set.
    private visibleToOrg(organizationId: string): SQL | undefined {
        const assignedAppIds = this.db
            .select({ id: m2mApplicationsOrganizationsTable.m2mAppId })
            .from(m2mApplicationsOrganizationsTable)
            .where(eq(m2mApplicationsOrganizationsTable.organizationId, organizationId));

        return or(
            eq(m2mApplicationsTable.ownerOrganizationId, organizationId),
            and(isNull(m2mApplicationsTable.ownerOrganizationId), inArray(m2mApplicationsTable.id, assignedAppIds))
        );
    }

    async searchPaginatedForOrg(
        organizationId: string,
        { limit, offset }: PaginationParams
    ): Promise<PaginatedResult<M2mApplication>> {
        const visibleToOrg = this.visibleToOrg(organizationId);

        const { count: countResult } = await this.db
            .select({ count: count() })
            .from(m2mApplicationsTable)
            .where(visibleToOrg)
            .then(getFirstOrThrow);

        const items = await this.db.query.m2mApplicationsTable.findMany({
            where: visibleToOrg,
            limit,
            offset,
            orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
            with: M2M_APP_RELATIONS
        });

        return {
            items: items.map(toM2mApplication),
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(countResult / limit),
                totalItems: countResult,
                limit,
                offset
            }
        };
    }

    async createForOrg(organizationId: string, data: CreateOrgM2mApplication): Promise<M2mApplication> {
        return this.transaction(async (tx) => {
            const created = await tx
                .insert(m2mApplicationsTable)
                .values({ name: data.name, description: data.description ?? null, ownerOrganizationId: organizationId })
                .returning()
                .then(getFirstOrThrow);

            const roles = await this.associateOrgRoles(data.roles, created.id, organizationId, tx);

            // An org-owned credential is never assigned to other organizations via the junction.
            return { ...created, roles, organizations: [], hasOverbroadIpWhitelist: false };
        });
    }

    // Update an org-owned credential's settings and role/permission selection. Scoped to org-owned: a
    // zone-level or peer-org credential is out of the caller's write scope and returns 404. Role
    // replacement goes through associateOrgRoles, so the org-admin ceiling is enforced on attachment.
    // The inline fetch (rather than getById) is the ownership check: getById does not filter by ownerOrganizationId.
    async updateForOrg(organizationId: string, appId: string, data: UpdateOrgM2mApplication): Promise<M2mApplication> {
        return this.transaction(async (tx) => {
            const existing = await tx.query.m2mApplicationsTable.findFirst({
                where: and(
                    eq(m2mApplicationsTable.id, appId),
                    eq(m2mApplicationsTable.ownerOrganizationId, organizationId)
                ),
                with: { roles: { with: { role: true } } }
            });
            if (!existing) {
                throw new EntityNotFound('M2mApplication', { id: appId });
            }

            const existingRoleIds = existing.roles.map(({ role }) => role.id);
            const newRoleIds = data.roles.map((role) => role.id);

            const rolesToDelete = existingRoleIds.filter((roleId) => !newRoleIds.includes(roleId));
            if (rolesToDelete.length > 0) {
                await tx
                    .delete(m2mAppRolesTable)
                    .where(and(eq(m2mAppRolesTable.m2mAppId, appId), inArray(m2mAppRolesTable.roleId, rolesToDelete)));
            }

            const rolesToCreate = data.roles.filter((role) => !existingRoleIds.includes(role.id));
            await this.associateOrgRoles(rolesToCreate, appId, organizationId, tx);

            await tx
                .update(m2mApplicationsTable)
                .set({ name: data.name, description: data.description ?? null })
                .where(
                    and(
                        eq(m2mApplicationsTable.id, appId),
                        eq(m2mApplicationsTable.ownerOrganizationId, organizationId)
                    )
                );

            return this.getById(appId, tx);
        });
    }

    // Org admins may delete only credentials their organization owns. A zone-level credential (even one
    // assigned to this org) or a peer-org credential is out of the caller's write scope and returns 404 —
    // the same "don't confirm existence" contract the read path follows.
    async deleteForOrg(organizationId: string, appId: string): Promise<void> {
        const returning = await this.db
            .delete(m2mApplicationsTable)
            .where(
                and(eq(m2mApplicationsTable.id, appId), eq(m2mApplicationsTable.ownerOrganizationId, organizationId))
            )
            .returning();
        if (returning.length === 0) {
            throw new EntityNotFound('M2mApplication', { id: appId });
        }
    }

    /** @throws EntityNotFound when the credential is outside the organization's visible set */
    async getVisibleToOrg(organizationId: string, appId: string): Promise<M2mApplication> {
        const app = await this.db.query.m2mApplicationsTable.findFirst({
            where: and(eq(m2mApplicationsTable.id, appId), this.visibleToOrg(organizationId)),
            with: M2M_APP_RELATIONS
        });

        if (!app) {
            throw new EntityNotFound('M2mApplication', { id: appId });
        }
        return toM2mApplication(app);
    }

    /**
     * Write scope for a credential's sub-resources: a zone-level credential is shared across organizations,
     * so one org must not mint keys or open IPs on it.
     * @throws EntityNotFound when the organization does not own the credential
     */
    async assertOwnedByOrg(organizationId: string, appId: string): Promise<void> {
        const [owned] = await this.db
            .select({ id: m2mApplicationsTable.id })
            .from(m2mApplicationsTable)
            .where(
                and(eq(m2mApplicationsTable.id, appId), eq(m2mApplicationsTable.ownerOrganizationId, organizationId))
            )
            .limit(1);

        if (!owned) {
            throw new EntityNotFound('M2mApplication', { id: appId });
        }
    }

    /**
     * The credential as an authenticating principal: roles owned by a soft-deleted organization are
     * dropped. A zone-level credential may hold an org-owned role, which would otherwise keep granting
     * that organization's visibility after it is deleted.
     */
    async getForAuth(id: string): Promise<M2mApplication> {
        const app = await this.getById(id);
        const scopedOrgIds = [...new Set(app.roles.map((role) => role.organizationId).filter((v) => v !== null))];
        if (scopedOrgIds.length === 0) {
            return app;
        }

        const live = await this.db
            .select({ id: organizationsTable.id })
            .from(organizationsTable)
            .where(and(inArray(organizationsTable.id, scopedOrgIds), isNull(organizationsTable.deletedAt)));
        const liveOrgIds = new Set(live.map((org) => org.id));

        return {
            ...app,
            roles: app.roles.filter((role) => role.organizationId === null || liveOrgIds.has(role.organizationId))
        };
    }

    async getById(id: string, tx?: TxType): Promise<M2mApplication> {
        const m2mApp = await (tx ?? this.db).query.m2mApplicationsTable.findFirst({
            where: (t, { eq }) => eq(t.id, id),
            with: M2M_APP_RELATIONS
        });

        if (!m2mApp) {
            throw new EntityNotFound('M2mApplication', { id });
        }

        return toM2mApplication(m2mApp);
    }

    async update(id: string, newData: UpdateM2mApplication): Promise<M2mApplication> {
        const { name, description, roles } = newData;

        return this.transaction(async (tx) => {
            const existing = await this.getById(id, tx);

            const newRoleIds = roles.map((role) => role.id);
            const rolesToDelete = existing.roles.filter((role) => !newRoleIds.includes(role.id)).map((role) => role.id);

            if (rolesToDelete.length > 0) {
                await tx
                    .delete(m2mAppRolesTable)
                    .where(
                        and(eq(m2mAppRolesTable.m2mAppId, existing.id), inArray(m2mAppRolesTable.roleId, rolesToDelete))
                    );
            }

            const existingRoleIds = existing.roles.map((role) => role.id);
            const rolesToCreate = roles.filter((role) => !existingRoleIds.includes(role.id));
            await this.associateRoles(rolesToCreate, existing.id, tx);

            await tx.update(m2mApplicationsTable).set({ name, description }).where(eq(m2mApplicationsTable.id, id));

            return this.getById(id, tx);
        });
    }

    async delete(id: string): Promise<void> {
        await this.getById(id);

        const returning = await this.db.delete(m2mApplicationsTable).where(eq(m2mApplicationsTable.id, id)).returning();
        if (returning.length === 0) {
            throw new EntityNotFound('M2mApplication', { id });
        }
    }

    async getOrganizations(id: string, tx?: TxType): Promise<M2mSelectedOrganization[]> {
        await this.getById(id, tx);

        return (tx ?? this.db)
            .select({ id: organizationsTable.id, name: organizationsTable.name })
            .from(m2mApplicationsOrganizationsTable)
            .innerJoin(organizationsTable, liveAssignedOrganization)
            .where(eq(m2mApplicationsOrganizationsTable.m2mAppId, id))
            .orderBy(asc(m2mApplicationsOrganizationsTable.organizationId));
    }

    async replaceOrganizations(id: string, organizationIds: string[]): Promise<M2mSelectedOrganization[]> {
        return this.transaction(async (tx) => {
            await this.getById(id, tx);

            await tx
                .delete(m2mApplicationsOrganizationsTable)
                .where(eq(m2mApplicationsOrganizationsTable.m2mAppId, id));

            if (organizationIds.length === 0) {
                return [];
            }

            await this.linkOrganizations(id, organizationIds, tx);

            const organizations = await tx.query.organizationsTable.findMany({
                columns: {
                    id: true,
                    name: true
                },
                where: inArray(organizationsTable.id, [...new Set(organizationIds)]),
                orderBy: (t, { asc }) => [asc(t.id)]
            });

            return organizations;
        });
    }

    async findAllWalletAddressesForApp(m2mAppId: string): Promise<Address[]> {
        const rows = await this.db
            .selectDistinct({ address: walletsTable.walletAddress })
            .from(walletsTable)
            .innerJoin(usersTable, eq(usersTable.id, walletsTable.userId))
            .innerJoin(
                m2mApplicationsOrganizationsTable,
                eq(m2mApplicationsOrganizationsTable.organizationId, usersTable.organizationId)
            )
            .innerJoin(organizationsTable, liveAssignedOrganization)
            .where(and(eq(m2mApplicationsOrganizationsTable.m2mAppId, m2mAppId), isNull(walletsTable.deletedAt)));

        return rows.map(({ address }) => address);
    }

    async walletAddressesForAppAmong(m2mAppId: string, candidates: Address[]): Promise<Address[]> {
        const rows = await fetchChunked(candidates, (chunk) =>
            this.db
                .selectDistinct({ address: walletsTable.walletAddress })
                .from(walletsTable)
                .innerJoin(usersTable, eq(usersTable.id, walletsTable.userId))
                .innerJoin(
                    m2mApplicationsOrganizationsTable,
                    eq(m2mApplicationsOrganizationsTable.organizationId, usersTable.organizationId)
                )
                .innerJoin(organizationsTable, liveAssignedOrganization)
                .where(
                    and(
                        eq(m2mApplicationsOrganizationsTable.m2mAppId, m2mAppId),
                        inArray(walletsTable.walletAddress, chunk),
                        isNull(walletsTable.deletedAt)
                    )
                )
        );

        return rows.map(({ address }) => address);
    }

    /** Member wallets of each live linked organization, keyed by organization id. Wallet-less orgs still get an entry. */
    async walletAddressesByOrgForApp(m2mAppId: string): Promise<Map<string, Address[]>> {
        const rows = await this.db
            .select({
                organizationId: m2mApplicationsOrganizationsTable.organizationId,
                address: walletsTable.walletAddress
            })
            .from(m2mApplicationsOrganizationsTable)
            .innerJoin(organizationsTable, liveAssignedOrganization)
            .leftJoin(usersTable, eq(usersTable.organizationId, m2mApplicationsOrganizationsTable.organizationId))
            .leftJoin(walletsTable, and(eq(walletsTable.userId, usersTable.id), isNull(walletsTable.deletedAt)))
            .where(eq(m2mApplicationsOrganizationsTable.m2mAppId, m2mAppId));

        const byOrg = new Map<string, Address[]>();
        for (const { organizationId, address } of rows) {
            const wallets = byOrg.get(organizationId) ?? [];
            if (address !== null) wallets.push(address);
            byOrg.set(organizationId, wallets);
        }
        return byOrg;
    }

    async findUserByAddressForApp(m2mAppId: string, address: Address): Promise<User | undefined> {
        const userId = await this.findUserIdByAddressForApp(m2mAppId, address);
        if (userId === undefined) return undefined;

        return this.db.repositories().users.findById(userId);
    }

    /** {@link findUserByAddressForApp} with full roles, for system-permission checks. */
    async findUserWithRolesByAddressForApp(m2mAppId: string, address: Address): Promise<UserWithRoles | undefined> {
        const userId = await this.findUserIdByAddressForApp(m2mAppId, address);
        if (userId === undefined) return undefined;

        return this.db.repositories().users.findByIdWithRoles(userId);
    }

    private async findUserIdByAddressForApp(m2mAppId: string, address: Address): Promise<string | undefined> {
        const [row] = await this.db
            .select({ userId: usersTable.id })
            .from(usersTable)
            .innerJoin(walletsTable, eq(walletsTable.userId, usersTable.id))
            .innerJoin(
                m2mApplicationsOrganizationsTable,
                eq(m2mApplicationsOrganizationsTable.organizationId, usersTable.organizationId)
            )
            .innerJoin(organizationsTable, liveAssignedOrganization)
            .where(
                and(
                    eq(m2mApplicationsOrganizationsTable.m2mAppId, m2mAppId),
                    eq(walletsTable.walletAddress, address),
                    isNull(walletsTable.deletedAt)
                )
            )
            .limit(1);

        return row?.userId;
    }

    private async linkOrganizations(
        m2mAppId: string,
        organizationIds: string[],
        tx: TxType
    ): Promise<M2mApplicationOrganization[]> {
        const uniqueOrganizationIds = [...new Set(organizationIds)];

        // A soft-deleted organization reads as missing here, so a credential cannot be assigned to one.
        const organizations = await tx.query.organizationsTable.findMany({
            columns: { id: true },
            where: and(inArray(organizationsTable.id, uniqueOrganizationIds), isNull(organizationsTable.deletedAt))
        });

        if (organizations.length !== uniqueOrganizationIds.length) {
            const foundIds = new Set(organizations.map((org) => org.id));
            const missingIds = uniqueOrganizationIds.filter((id) => !foundIds.has(id));
            throw new EntityNotFound('Organization', { id: missingIds.join(',') });
        }

        await tx.insert(m2mApplicationsOrganizationsTable).values(
            uniqueOrganizationIds.map((organizationId) => ({
                m2mAppId,
                organizationId
            }))
        );

        return organizations;
    }

    private async associateRoles(
        roles: InsertM2mApplication['roles'],
        m2mAppId: string,
        tx: TxType
    ): Promise<M2mApplication['roles']> {
        if (roles.length === 0) {
            return [];
        }

        const roleIds = roles.map((role) => role.id);
        const existingRoles = await tx.query.rolesTable.findMany({
            where: inArray(rolesTable.id, roleIds)
        });
        const existingRoleIds = new Set(existingRoles.map((role) => role.id));
        const missingRoles = roleIds.filter((id) => !existingRoleIds.has(id));

        if (missingRoles.length > 0) {
            throw new EntityNotFound('Role', { id: missingRoles.join(',') });
        }

        await tx.insert(m2mAppRolesTable).values(
            roleIds.map((roleId) => ({
                m2mAppId,
                roleId
            }))
        );

        return existingRoles;
    }

    // Attaching a role to a credential is a privilege-granting action, so it carries its own guard:
    // the org-admin ceiling is otherwise enforced only at role create/update, never at attachment.
    // Every role must belong to this organization (so an org admin can't attach a zone-level or
    // peer-org role — e.g. the all-powerful zone `admin` role), and — defense in depth — must sit
    // within the org-admin ceiling even though org-owned roles were already constrained at creation.
    private async associateOrgRoles(
        roles: Pick<Role, 'id'>[],
        m2mAppId: string,
        organizationId: string,
        tx: TxType
    ): Promise<Role[]> {
        if (roles.length === 0) {
            return [];
        }

        const resolved = await tx.query.rolesTable.findMany({
            where: and(
                inArray(
                    rolesTable.id,
                    roles.map((role) => role.id)
                ),
                eq(rolesTable.organizationId, organizationId)
            )
        });

        const resolvedIds = new Set(resolved.map((role) => role.id));
        const missing = roles.filter((role) => !resolvedIds.has(role.id));
        if (missing.length > 0) {
            // Zone-level, peer-org, or nonexistent roles all surface as not-found without disclosing which.
            throw new EntityNotFound('Role', { id: missing.map((role) => role.id).join(',') });
        }

        const outsideCeiling = permissionsOutsideOrgCeiling(resolved.flatMap((role) => role.systemPermissions ?? []));
        if (outsideCeiling.length > 0) {
            const disallowed = [...new Set(outsideCeiling)];
            throw new InvalidInputError(
                `Role grants permissions not allowed for organization credentials: ${disallowed.join(', ')}`
            );
        }

        await tx.insert(m2mAppRolesTable).values(
            roles.map((role) => ({
                m2mAppId,
                roleId: role.id
            }))
        );

        return resolved;
    }
}
