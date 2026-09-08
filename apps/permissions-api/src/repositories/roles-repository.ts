import { ADMIN_ROLE_ID, ADMIN_ROLE_NAME, ORG_ADMIN_ROLE_NAME, RESERVED_ROLE_NAMES } from '@repo/access-control';
import { and, asc, count, eq, getTableColumns, ilike, isNull, sql } from 'drizzle-orm';
import { isForeignKeyConstraintError, isNoValuesToSetError, isUniqueConstraintError } from '../db/errors';
import { contractFunctionPermissionRolesTable, rolesTable, userRolesTable } from '../db/schema';
import { escapeLike, getFirstOrThrow } from '../db/utils';
import { permissionsOutsideOrgCeiling, SystemPermissions } from '../permissions/system-permissions';
import {
    EntityAlreadyExistsError,
    EntityNotFound,
    ForbiddenError,
    InvalidEntity,
    InvalidInputError
} from '../utils/error-types';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { EntityRepository } from './entity-repository';
import { paginate } from './paginate';

export type Role = typeof rolesTable.$inferSelect;
// A role reference that only guarantees identity and display name; remaining columns are optional
// because callers frequently attach roles from join-table projections.
export type BareRole = Pick<Role, 'id' | 'roleName'> & Partial<Omit<Role, 'id' | 'roleName'>>;
export type RoleWithCounts = Role & { usersCount: number; contractPermissionsCount: number };
// `id` is server-generated; `isSystemRole` is server-controlled (set by create/createOrUpdate*),
// never supplied by callers.
export type InsertRole = Omit<typeof rolesTable.$inferInsert, 'id' | 'isSystemRole'>;

const RolesRepositoryBase = EntityRepository({
    table: rolesTable,
    idColumn: rolesTable.id,
    entityName: 'Role',
    defaultOrderBy: [asc(rolesTable.roleName)],
    baseFilter: isNull(rolesTable.organizationId)
});

export class RolesRepository extends RolesRepositoryBase {
    async create(role: InsertRole, opts: { organizationId?: string } = {}): Promise<Role> {
        this.assertNameNotReserved(role.roleName);

        let organizationId: string | null;
        if (opts.organizationId !== undefined) {
            // This case is when called from organization routes
            this.assertWithinOrgCeiling(role.systemPermissions);
            organizationId = opts.organizationId;
        } else {
            organizationId = role.organizationId ?? null;
        }

        if (opts.organizationId !== undefined && role.organizationId && role.organizationId !== opts.organizationId) {
            throw new ForbiddenError('cannot create roles for another organization');
        }

        try {
            return await this.db
                .insert(rolesTable)
                .values({
                    roleName: role.roleName,
                    systemPermissions: role.systemPermissions,
                    isSystemRole: false,
                    organizationId
                })
                .returning()
                .then(getFirstOrThrow);
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new EntityAlreadyExistsError(`Role with name="${role.roleName}" already exists`);
            }
            throw error;
        }
    }

    async findScoped(id: string, opts: { organizationId?: string } = {}): Promise<Role | undefined> {
        return this.db.query.rolesTable.findFirst({
            where: and(eq(rolesTable.id, id), this.scopeFilter(opts.organizationId))
        });
    }

    // Scopes a query to a specific organization, or to the zone (organizationId IS NULL).
    // Without an organizationId a zone lookup must not match org-owned roles.
    private scopeFilter(organizationId: string | undefined) {
        return organizationId !== undefined
            ? eq(rolesTable.organizationId, organizationId)
            : isNull(rolesTable.organizationId);
    }

    async updateById(id: string, role: InsertRole): Promise<Role> {
        const updatedRole = await this.updateScoped(id, role);
        if (updatedRole === undefined) {
            throw new EntityNotFound('Role', { id });
        }
        return updatedRole;
    }

    async updateScoped(
        id: string,
        role: InsertRole,
        opts: { organizationId?: string } = {}
    ): Promise<Role | undefined> {
        const oldRole = await this.findScoped(id, opts);
        if (oldRole === undefined) {
            return undefined;
        }
        if (oldRole.isSystemRole) {
            throw new InvalidEntity('system roles cannot be updated');
        }

        this.assertNameNotReserved(role.roleName);
        let organizationId: string | null;
        if (opts.organizationId !== undefined) {
            // This case is when called from organization routes
            this.assertWithinOrgCeiling(role.systemPermissions);
            organizationId = opts.organizationId;
        } else {
            organizationId = role.organizationId ?? null;
        }

        try {
            const [updatedRole] = await this.db
                .update(rolesTable)
                .set({
                    roleName: role.roleName,
                    systemPermissions: role.systemPermissions,
                    organizationId
                })
                .where(and(eq(rolesTable.id, id), this.scopeFilter(opts.organizationId)))
                .returning();

            return updatedRole;
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new EntityAlreadyExistsError(`Role with name="${role.roleName}" already exists`);
            }
            if (isNoValuesToSetError(error)) {
                throw new InvalidInputError('No fields to update');
            }
            throw error;
        }
    }

    async deleteById(id: string): Promise<Role> {
        const role = await this.getById(id);
        if (role.isSystemRole) {
            throw new InvalidEntity('system roles cannot be deleted');
        }

        try {
            return await super.deleteById(id);
        } catch (error) {
            if (isForeignKeyConstraintError(error)) {
                throw new InvalidEntity('role cannot be deleted while it is still referenced');
            }
            throw error;
        }
    }

    async deleteScoped(id: string, opts: { organizationId?: string } = {}): Promise<boolean> {
        try {
            return await this.transaction(async (tx) => {
                const role = await tx.query.rolesTable.findFirst({
                    where: and(eq(rolesTable.id, id), this.scopeFilter(opts.organizationId))
                });
                if (role === undefined) {
                    return false;
                }
                if (role.isSystemRole) {
                    throw new InvalidEntity('system roles cannot be deleted');
                }

                const [deletedRole] = await tx
                    .delete(rolesTable)
                    .where(and(eq(rolesTable.id, id), this.scopeFilter(opts.organizationId)))
                    .returning();
                return deletedRole !== undefined;
            });
        } catch (error) {
            if (isForeignKeyConstraintError(error)) {
                throw new InvalidEntity('role cannot be deleted while it is still referenced');
            }
            throw error;
        }
    }

    async findPaginated({
        limit,
        offset,
        searchQuery,
        organizationId
    }: PaginationParams & { searchQuery?: string; organizationId?: string }): Promise<PaginatedResult<RoleWithCounts>> {
        const whereClause = and(
            searchQuery ? ilike(rolesTable.roleName, `%${escapeLike(searchQuery)}%`) : undefined,
            this.scopeFilter(organizationId)
        );

        return paginate({
            totalItems: this.db
                .select({ count: count() })
                .from(rolesTable)
                .where(whereClause)
                .then((rows) => getFirstOrThrow(rows).count),
            items: this.db
                .select({
                    ...getTableColumns(rolesTable),
                    usersCount: sql<number>`(
                        SELECT count(*)::int FROM ${userRolesTable}
                        WHERE ${eq(userRolesTable.roleId, rolesTable.id)}
                    )`,
                    contractPermissionsCount: sql<number>`(
                        SELECT count(*)::int FROM ${contractFunctionPermissionRolesTable}
                        WHERE ${eq(contractFunctionPermissionRolesTable.roleId, rolesTable.id)}
                    )`
                })
                .from(rolesTable)
                .where(whereClause)
                .orderBy(asc(rolesTable.roleName))
                .limit(limit)
                .offset(offset),
            limit,
            offset
        });
    }

    async createOrUpdateAdminRole() {
        const adminRole = await this.db
            .insert(rolesTable)
            .values({
                id: ADMIN_ROLE_ID,
                roleName: ADMIN_ROLE_NAME,
                systemPermissions: SystemPermissions.options,
                isSystemRole: true,
                organizationId: null
            })
            .onConflictDoUpdate({
                target: [rolesTable.organizationId, rolesTable.roleName],
                set: { systemPermissions: SystemPermissions.options, organizationId: null }
            })
            .returning()
            .then(getFirstOrThrow);

        // The stable id is load-bearing config surface (ADMIN_ROLE_ID drives admin auth, SWAGGER
        // allow-listing, and operator config). If an environment's row predates the migration that
        // pins it, every id-based admin check silently fails closed; fail loud at boot instead.
        if (adminRole.id !== ADMIN_ROLE_ID) {
            throw new Error(`Zone admin role has id "${adminRole.id}", expected "${ADMIN_ROLE_ID}"`);
        }
        return adminRole;
    }

    // The org admin role is identified structurally (system role owned by the org), not by
    // name: a migrated environment may still carry the legacy "Admin(<orgId>)" name.
    async findOrgAdminRole(orgId: string): Promise<Role | undefined> {
        return this.db.query.rolesTable.findFirst({
            where: (t, { eq, and }) => and(eq(t.organizationId, orgId), eq(t.isSystemRole, true))
        });
    }

    async orgAdminRole(orgId: string): Promise<Role> {
        const org = await this.db.repositories().organizations.getById(orgId);

        const existing = await this.findOrgAdminRole(org.id);

        if (existing !== undefined) {
            return existing;
        }

        try {
            return await this.db
                .insert(rolesTable)
                .values({
                    roleName: ORG_ADMIN_ROLE_NAME,
                    systemPermissions: [SystemPermissions.enum.admin_read, SystemPermissions.enum.admin_write],
                    isSystemRole: true,
                    organizationId: org.id
                })
                .returning()
                .then(getFirstOrThrow);
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                // A concurrent orgAdminRole call (two first-logins into a fresh org) may have created
                // the system role between our findOrgAdminRole check and this insert. Prefer that row
                // so the org keeps exactly one admin system role.
                const concurrent = await this.findOrgAdminRole(org.id);
                if (concurrent !== undefined) {
                    return concurrent;
                }
                // Otherwise the org already has a custom role holding the default admin name; fall back
                // to a unique suffixed name rather than hijacking the existing role.
                return await this.db
                    .insert(rolesTable)
                    .values({
                        roleName: `${ORG_ADMIN_ROLE_NAME}(${org.id})`,
                        systemPermissions: [SystemPermissions.enum.admin_read, SystemPermissions.enum.admin_write],
                        isSystemRole: true,
                        organizationId: org.id
                    })
                    .returning()
                    .then(getFirstOrThrow);
            }
            throw error;
        }
    }

    private assertNameNotReserved(roleName: string): void {
        if (RESERVED_ROLE_NAMES.has(roleName)) {
            throw new InvalidEntity(`"${roleName}" is a reserved role name`);
        }
    }

    private assertWithinOrgCeiling(systemPermissions: readonly string[]): void {
        const disallowed = permissionsOutsideOrgCeiling(systemPermissions);
        if (disallowed.length > 0) {
            throw new InvalidInputError(`Permissions not grantable by an organization admin: ${disallowed.join(', ')}`);
        }
    }
}
