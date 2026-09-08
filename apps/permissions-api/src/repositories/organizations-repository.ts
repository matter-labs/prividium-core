import { and, count, eq, inArray, isNull, like } from 'drizzle-orm';
import type { Address } from 'viem';
import type { TxType } from '../db';
import { isNoValuesToSetError } from '../db/errors';
import {
    organizationsDefaultRoles,
    organizationsTable,
    rolesTable,
    UserSources,
    userRolesTable,
    usersTable,
    walletsTable
} from '../db/schema';
import { getFirst, getFirstOrThrow } from '../db/utils';
import { permissionsOutsideOrgCeiling } from '../permissions/system-permissions';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError } from '../utils/error-types';
import { fetchChunked } from '../utils/fetch-chunked';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';
import type { BareRole, Role } from './roles-repository';
import { type RoleScopeOptions, USER_ORGANIZATION_COLUMNS, type User } from './users-repository';

type OrganizationRow = typeof organizationsTable.$inferSelect;

export type Organization = OrganizationRow & {
    defaultRoles: BareRole[];
};

export type InsertOrganization = Omit<typeof organizationsTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> & {
    defaultRoles: Pick<Role, 'id'>[];
};

export type UpdateOrganization = InsertOrganization;

export type UpdateBranding = Partial<Pick<OrganizationRow, 'name' | 'brandName' | 'logoUrl' | 'primaryColor'>>;

export type UpdateSiweSettings = Pick<OrganizationRow, 'siweLoginEnabled' | 'siweAllowedDomains'>;

export type MemberRoleOptions = { allowOverCeilingRoles?: boolean };

export class OrganizationsRepository extends BaseRepository {
    async create(data: InsertOrganization, roleScope?: RoleScopeOptions): Promise<Organization> {
        const { defaultRoles, ...organizationFields } = data;

        return this.transaction(async (tx) => {
            const created = await tx
                .insert(organizationsTable)
                .values(organizationFields)
                .returning()
                .then(getFirstOrThrow);
            const associatedRoles = await this.associateRoles(defaultRoles, created.id, tx, roleScope);

            return {
                ...created,
                defaultRoles: associatedRoles
            };
        });
    }

    async countNonDeleted(): Promise<number> {
        const { count: countResult } = await this.db
            .select({ count: count() })
            .from(organizationsTable)
            .where(isNull(organizationsTable.deletedAt))
            .then(getFirstOrThrow);
        return countResult;
    }

    async searchPaginated({ limit, offset }: PaginationParams): Promise<PaginatedResult<Organization>> {
        const countResult = await this.countNonDeleted();

        const rows = await this.db.query.organizationsTable.findMany({
            where: (t, { isNull }) => isNull(t.deletedAt),
            limit,
            offset,
            orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
            with: {
                defaultRoles: {
                    with: { role: { columns: { id: true, roleName: true } } }
                }
            }
        });

        return {
            items: rows.map((row) => ({ ...row, defaultRoles: row.defaultRoles.map((dr) => dr.role) })),
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(countResult / limit),
                totalItems: countResult,
                limit,
                offset
            }
        };
    }

    async getById(id: string, tx?: TxType): Promise<Organization> {
        const organization = await (tx ?? this.db).query.organizationsTable.findFirst({
            where: (t, { eq, and, isNull }) => and(eq(t.id, id), isNull(t.deletedAt)),
            with: {
                defaultRoles: {
                    with: { role: { columns: { id: true, roleName: true } } }
                }
            }
        });

        if (!organization) {
            throw new EntityNotFound('Organization', { id });
        }

        return { ...organization, defaultRoles: organization.defaultRoles.map((dr) => dr.role) };
    }

    async findActiveId(id: string): Promise<string | undefined> {
        const organization = await this.db.query.organizationsTable.findFirst({
            columns: { id: true },
            where: (t, { eq, and, isNull }) => and(eq(t.id, id), isNull(t.deletedAt))
        });
        return organization?.id;
    }

    async update(id: string, newData: UpdateOrganization, roleScope?: RoleScopeOptions): Promise<Organization> {
        const { defaultRoles, ...rest } = newData;

        return this.transaction(async (tx) => {
            const existing = await this.getById(id, tx);

            const newRoleIds = defaultRoles.map((r) => r.id);
            const rolesToDelete = existing.defaultRoles
                .filter((role) => !newRoleIds.includes(role.id))
                .map((role) => role.id);

            if (rolesToDelete.length > 0) {
                await tx
                    .delete(organizationsDefaultRoles)
                    .where(
                        and(
                            eq(organizationsDefaultRoles.organizationId, id),
                            inArray(organizationsDefaultRoles.roleId, rolesToDelete)
                        )
                    );
            }

            const existingRoleIds = existing.defaultRoles.map((r) => r.id);
            const rolesToCreate = defaultRoles.filter((r) => !existingRoleIds.includes(r.id));
            await this.associateRoles(rolesToCreate, id, tx, roleScope);

            await tx.update(organizationsTable).set(rest).where(eq(organizationsTable.id, id));

            return await this.getById(id, tx);
        });
    }

    async delete(id: string): Promise<void> {
        await this.getById(id);

        // Soft delete: keep the row (and its memberships, m2m links, and audit records) intact rather than
        // cascading them away. Filtering soft-deleted organizations out of reads is handled separately.
        const returning = await this.db
            .update(organizationsTable)
            .set({ deletedAt: new Date() })
            .where(eq(organizationsTable.id, id))
            .returning();
        if (returning.length === 0) {
            throw new EntityNotFound('Organization', { id });
        }
    }

    async usersFor(
        organizationId: string,
        { limit, offset, displayName, roleId }: PaginationParams & { displayName?: string; roleId?: string }
    ): Promise<PaginatedResult<User>> {
        await this.getById(organizationId);

        const membersWithRole = this.db
            .select({ userId: userRolesTable.userId })
            .from(userRolesTable)
            .where(eq(userRolesTable.roleId, roleId ?? ''));
        const memberFilter = and(
            eq(usersTable.organizationId, organizationId),
            displayName ? like(usersTable.displayName, `%${displayName}%`) : undefined,
            roleId ? inArray(usersTable.id, membersWithRole) : undefined
        );

        const rows = await this.db.query.usersTable.findMany({
            where: memberFilter,
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: { columns: { id: true, roleName: true } } } },
                wallets: {
                    where: (t, { isNull }) => isNull(t.deletedAt)
                }
            },
            orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
            limit,
            offset
        });
        const items = rows.map((row) => ({ ...row, roles: row.roles.map((r) => r.role) }));

        const { count: countResult } = await this.db
            .select({ count: count() })
            .from(usersTable)
            .where(memberFilter)
            .then(getFirstOrThrow);

        return {
            items,
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(countResult / limit),
                totalItems: countResult,
                limit,
                offset
            }
        };
    }

    async getMember(organizationId: string, userId: string): Promise<User> {
        await this.getById(organizationId);

        const member = await this.db.query.usersTable.findFirst({
            where: (t, { and, eq }) => and(eq(t.id, userId), eq(t.organizationId, organizationId)),
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: { columns: { id: true, roleName: true } } } },
                wallets: { where: (t, { isNull }) => isNull(t.deletedAt) }
            }
        });

        // A user outside this org 404s exactly like a non-existent one — never confirm a peer org's membership.
        if (member === undefined) {
            throw new EntityNotFound('User', { id: userId });
        }

        return { ...member, roles: member.roles.map((r) => r.role) };
    }

    // Pre-authorize a member by OIDC subject: create an org-scoped account with a null issuer that
    // claimUnissuedUser (jwt-validator-service) stamps with the verified issuer on the member's first
    // login through the org's IdP. The unique oidcSub constraint rejects a subject that already exists
    // anywhere (EntityAlreadyExistsError). displayName is a pre-login placeholder — the IdP token
    // overwrites it on first login.
    async inviteMemberByOidcSub(
        organizationId: string,
        { oidcSub, displayName }: { oidcSub: string; displayName: string }
    ): Promise<User> {
        return this.transaction(async (tx) => {
            await this.getById(organizationId, tx);
            return tx.repositories().users.create({
                oidcSub,
                oidcIssuer: null,
                displayName,
                roles: [],
                wallets: [],
                source: UserSources.enum.oidc,
                organizationId
            });
        });
    }

    async setMemberRoles(
        organizationId: string,
        userId: string,
        roleIds: string[],
        { allowOverCeilingRoles = false }: MemberRoleOptions = {}
    ): Promise<User> {
        return this.transaction(async (tx) => {
            await this.getById(organizationId, tx);

            const member = await tx.query.usersTable.findFirst({
                where: and(eq(usersTable.id, userId), eq(usersTable.organizationId, organizationId)),
                with: { roles: { columns: { roleId: true } } }
            });
            // A non-member 404s exactly like a peer org's member, so cross-org membership never leaks.
            if (member === undefined) {
                throw new EntityNotFound('User', { id: userId });
            }

            const ownRoles = await tx.query.rolesTable.findMany({
                where: eq(rolesTable.organizationId, organizationId),
                columns: { id: true, isSystemRole: true, systemPermissions: true }
            });
            const ownRoleIds = new Set(ownRoles.map((r) => r.id));

            const notOwned = roleIds.filter((id) => !ownRoleIds.has(id));
            if (notOwned.length > 0) {
                throw new InvalidInputError(`Roles do not belong to this organization: ${notOwned.join(', ')}`);
            }

            const current = member.roles.map((r) => r.roleId).filter((id) => ownRoleIds.has(id));

            // A zone operator can mint an org role above the ceiling, so roles being added are
            // re-checked. Held roles echoed by the full-replace PUT grant nothing new, and the org
            // admin system role grants nothing the calling org admin lacks.
            if (!allowOverCeilingRoles) {
                const granted = ownRoles
                    .filter((r) => roleIds.includes(r.id) && !current.includes(r.id) && !r.isSystemRole)
                    .flatMap((r) => r.systemPermissions);
                const disallowed = [...new Set(permissionsOutsideOrgCeiling(granted))];
                if (disallowed.length > 0) {
                    throw new InvalidInputError(
                        `Permissions not grantable by an organization admin: ${disallowed.join(', ')}`
                    );
                }
            }

            const toRemove = current.filter((id) => !roleIds.includes(id));
            const toAdd = roleIds.filter((id) => !current.includes(id));

            if (toRemove.length > 0) {
                await tx
                    .delete(userRolesTable)
                    .where(and(eq(userRolesTable.userId, userId), inArray(userRolesTable.roleId, toRemove)));
            }
            if (toAdd.length > 0) {
                await tx.insert(userRolesTable).values(toAdd.map((roleId) => ({ userId, roleId })));
            }

            // tx-bound read so the response reflects the just-written assignments before commit.
            return tx.repositories().organizations.getMember(organizationId, userId);
        });
    }

    async addUser(
        organizationId: string,
        userId: string,
        { allowZoneRoles = false }: RoleScopeOptions = {}
    ): Promise<User> {
        return this.transaction(async (tx) => {
            await this.getById(organizationId, tx);
            const user = await tx.repositories().users.findById(userId);

            if (!user) {
                throw new EntityNotFound('User', { id: userId });
            }

            if (user.organizationId === organizationId) {
                return user;
            }

            if (user.organizationId) {
                throw new EntityAlreadyExistsError('User already belongs to another organization');
            }

            if (!allowZoneRoles && user.roles.length > 0) {
                throw new InvalidInputError(
                    'User holds zone roles; remove them before assigning the user to an organization'
                );
            }

            const result = await tx
                .update(usersTable)
                .set({ organizationId })
                .where(and(eq(usersTable.id, userId), isNull(usersTable.organizationId)))
                .returning();

            if (result.length === 0) {
                throw new EntityAlreadyExistsError('User already belongs to another organization');
            }

            const updated = await tx.repositories().users.findById(userId);
            if (!updated) {
                throw new EntityNotFound('User', { id: userId });
            }

            return updated;
        });
    }

    async removeUser(organizationId: string, userId: string): Promise<void> {
        return this.transaction(async (tx) => {
            await this.getById(organizationId, tx);
            const user = await tx.repositories().users.findById(userId);

            if (!user || user.organizationId !== organizationId) {
                throw new EntityNotFound('User', { id: userId });
            }

            // Drop org-scoped roles so a re-added member doesn't silently regain them.
            const orgRoleIds = tx
                .select({ id: rolesTable.id })
                .from(rolesTable)
                .where(eq(rolesTable.organizationId, organizationId));
            await tx
                .delete(userRolesTable)
                .where(and(eq(userRolesTable.userId, userId), inArray(userRolesTable.roleId, orgRoleIds)));

            await tx.update(usersTable).set({ organizationId: null }).where(eq(usersTable.id, userId));
        });
    }

    async walletBelongsToOrgList(wallet: Address, orgIds: string[]): Promise<boolean> {
        if (orgIds.length === 0) {
            return false;
        }

        const user = await this.db
            .select({ id: usersTable.id })
            .from(usersTable)
            .innerJoin(walletsTable, eq(walletsTable.userId, usersTable.id))
            .innerJoin(organizationsTable, eq(organizationsTable.id, usersTable.organizationId))
            .where(
                and(
                    eq(walletsTable.walletAddress, wallet),
                    isNull(walletsTable.deletedAt),
                    inArray(usersTable.organizationId, orgIds),
                    isNull(organizationsTable.deletedAt)
                )
            )
            .limit(1)
            .then(getFirst);

        return user !== undefined;
    }

    /** Bounded by `candidates` so a block filter's cost tracks the block, not the organization's size. */
    async userWalletsForOrgListAmong(orgIds: string[], candidates: Address[]): Promise<Address[]> {
        if (orgIds.length === 0) {
            return [];
        }

        const rows = await fetchChunked(candidates, (chunk) =>
            this.db
                .selectDistinct({ address: walletsTable.walletAddress })
                .from(usersTable)
                .innerJoin(walletsTable, eq(walletsTable.userId, usersTable.id))
                .innerJoin(organizationsTable, eq(organizationsTable.id, usersTable.organizationId))
                .where(
                    and(
                        inArray(usersTable.organizationId, orgIds),
                        inArray(walletsTable.walletAddress, chunk),
                        isNull(walletsTable.deletedAt),
                        isNull(organizationsTable.deletedAt)
                    )
                )
        );

        return rows.map((r) => r.address);
    }

    async updateBranding(id: string, branding: UpdateBranding): Promise<Organization> {
        return this.transaction(async (tx) => {
            await this.getById(id, tx);
            try {
                // Drizzle skips `undefined` fields, so an all-omitted body yields no columns to set.
                await tx.update(organizationsTable).set(branding).where(eq(organizationsTable.id, id));
            } catch (error) {
                if (isNoValuesToSetError(error)) {
                    throw new InvalidInputError('No branding fields to update');
                }
                throw error;
            }
            return this.getById(id, tx);
        });
    }

    async updateSiweSettings(id: string, settings: UpdateSiweSettings): Promise<Organization> {
        return this.transaction(async (tx) => {
            await this.getById(id, tx);
            await tx.update(organizationsTable).set(settings).where(eq(organizationsTable.id, id));
            return this.getById(id, tx);
        });
    }

    async listAdmins(organizationId: string): Promise<User[]> {
        await this.getById(organizationId);
        const adminRole = await this.db.repositories().roles.findOrgAdminRole(organizationId);
        if (adminRole === undefined) {
            return [];
        }
        const adminUserIds = this.db
            .select({ userId: userRolesTable.userId })
            .from(userRolesTable)
            .where(eq(userRolesTable.roleId, adminRole.id));

        const rows = await this.db.query.usersTable.findMany({
            where: and(eq(usersTable.organizationId, organizationId), inArray(usersTable.id, adminUserIds)),
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: true } },
                wallets: { where: (t, { isNull }) => isNull(t.deletedAt) }
            },
            orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)]
        });
        return rows.map((row) => ({ ...row, roles: row.roles.map((r) => r.role) }));
    }

    private async associateRoles(
        roles: InsertOrganization['defaultRoles'],
        organizationId: string,
        tx: TxType,
        { allowZoneRoles = false }: RoleScopeOptions = {}
    ): Promise<Organization['defaultRoles']> {
        if (roles.length === 0) {
            return [];
        }

        const roleIds = roles.map((role) => role.id);
        const existingRoles = await tx.query.rolesTable.findMany({
            columns: { id: true, roleName: true, organizationId: true, isSystemRole: true },
            where: inArray(rolesTable.id, roleIds)
        });

        const existingRoleIds = new Set(existingRoles.map((role) => role.id));
        const missingRoles = roleIds.filter((id) => !existingRoleIds.has(id));

        if (missingRoles.length > 0) {
            throw new EntityNotFound('Role', { id: missingRoles.join(',') });
        }

        // Defaults are auto-stamped onto new members, so they must be assignable to them: this org's own
        // custom roles, plus zone roles where members may hold those (a system role grants admin).
        for (const role of existingRoles) {
            const outOfScope =
                role.organizationId !== organizationId && !(allowZoneRoles && role.organizationId === null);
            if (outOfScope || role.isSystemRole) {
                throw new InvalidInputError(`Role "${role.id}" cannot be a default role for this organization`);
            }
        }

        await tx.insert(organizationsDefaultRoles).values(roleIds.map((roleId) => ({ organizationId, roleId })));
        // organizationId is selected only for the guard above; the response shape is { id, roleName }.
        return existingRoles.map(({ id, roleName }) => ({ id, roleName }));
    }
}
