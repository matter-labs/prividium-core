import { and, count, eq, inArray, isNull, like, or } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import type { TxType } from '../db';
import { extractForeignKeyConstraintProblem, isForeignKeyConstraintError, isUniqueConstraintError } from '../db/errors';
import { organizationsTable, rolesTable, UserSources, userRolesTable, usersTable, walletsTable } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError, UnexpectedDbError } from '../utils/error-types';
import { belongsToDeletedOrganization } from '../utils/organization-membership';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';
import type { BareRole, Role } from './roles-repository';

type UserRow = typeof usersTable.$inferSelect;
// Mirrors the wallet response shape: the soft-delete marker is never surfaced on a user's wallets.
type Wallet = Omit<typeof walletsTable.$inferSelect, 'deletedAt'>;
// Carries `deletedAt` so authorization can reject a dead-org principal without a second query.
type LightweightOrganization = { id: string; name: string; deletedAt: Date | null };

/**
 * Column set for the organization relation on every user read. Shared so a new query cannot load a
 * user whose organization is missing the liveness marker authorization checks.
 */
export const USER_ORGANIZATION_COLUMNS = { id: true, name: true, deletedAt: true } as const;

export type User = UserRow & {
    organization: LightweightOrganization | null;
    roles: BareRole[];
    wallets: Wallet[];
};
export type UserWithRoles = UserRow & {
    organization: LightweightOrganization | null;
    roles: Role[];
    wallets: Wallet[];
};
export type InsertUser = Omit<typeof usersTable.$inferInsert, 'organizationId'> & {
    displayName: string;
    /** Role ids to assign. */
    roles?: string[];
    wallets?: Address[];
    organizationId?: string | null;
};
export type UpdateUser = Partial<Omit<typeof usersTable.$inferInsert, 'organizationId'>> & {
    displayName?: string;
    /** Role ids replacing the user's current assignments. */
    roles?: string[];
    wallets?: Address[];
};

/** Zone-only deployments pass `allowZoneRoles`, where no org-scoped role exists for a member to hold. */
export type RoleScopeOptions = { allowZoneRoles?: boolean };

export class UsersRepository extends BaseRepository {
    async createFromAdminApi(newUser: Omit<InsertUser, 'source'>, roleScope?: RoleScopeOptions) {
        return this.create({ ...newUser, source: UserSources.enum.adminPanel }, roleScope);
    }

    async create(newUser: InsertUser, roleScope?: RoleScopeOptions) {
        const block = async (tx: TxType) => {
            let user: typeof usersTable.$inferSelect;
            try {
                user = await tx
                    .insert(usersTable)
                    .values({
                        oidcSub: newUser.oidcSub,
                        oidcIssuer: newUser.oidcIssuer,
                        displayName: newUser.displayName,
                        createdAt: newUser.createdAt,
                        updatedAt: newUser.updatedAt,
                        source: newUser.source,
                        organizationId: newUser.organizationId
                    })
                    .returning()
                    .then(getFirstOrThrow);
            } catch (err) {
                if (isUniqueConstraintError(err)) {
                    throw new EntityAlreadyExistsError('User already exists');
                }
                throw err;
            }

            // Assign roles if provided
            if (newUser.roles && newUser.roles.length > 0) {
                await this.assertRolesMatchOrganization(tx, newUser.roles, newUser.organizationId ?? null, roleScope);
                try {
                    await tx.insert(userRolesTable).values(
                        newUser.roles.map((roleId) => ({
                            userId: user.id,
                            roleId
                        }))
                    );
                } catch (e) {
                    if (isForeignKeyConstraintError(e)) {
                        const role = extractForeignKeyConstraintProblem(e);
                        throw new EntityNotFound('role', { id: role });
                    }
                    throw e;
                }
            }

            // Assign wallet addresses if provided
            if (newUser.wallets && newUser.wallets.length > 0) {
                try {
                    await tx.insert(walletsTable).values(
                        newUser.wallets.map((walletAddress) => ({
                            userId: user.id,
                            walletAddress
                        }))
                    );
                } catch (err) {
                    if (isUniqueConstraintError(err)) {
                        throw new EntityAlreadyExistsError('Wallet is associated with another user');
                    }
                    throw err;
                }
            }

            // Return user with roles and wallets
            const createdUser = await tx.query.usersTable.findFirst({
                with: {
                    organization: { columns: USER_ORGANIZATION_COLUMNS },
                    roles: { with: { role: true } },
                    wallets: {
                        where: (f, { isNull }) => isNull(f.deletedAt)
                    }
                },
                where: eq(usersTable.id, user.id)
            });
            if (!createdUser) {
                throw new UnexpectedDbError('Failed to create user');
            }

            return { ...createdUser, roles: createdUser.roles.map((r) => r.role) };
        };

        return await this.transaction(block);
    }

    private async assertRolesMatchOrganization(
        tx: TxType,
        roleIds: string[],
        organizationId: string | null,
        { allowZoneRoles = false }: RoleScopeOptions = {}
    ): Promise<void> {
        if (roleIds.length === 0) {
            return;
        }

        const roles = await tx.query.rolesTable.findMany({
            columns: { id: true, organizationId: true },
            where: inArray(rolesTable.id, roleIds)
        });

        const found = new Set(roles.map((r) => r.id));
        const missing = roleIds.filter((id) => !found.has(id));
        if (missing.length > 0) {
            throw new EntityNotFound('role', { id: missing.join(',') });
        }

        const outOfScope = (role: { organizationId: string | null }) =>
            role.organizationId !== organizationId && !(allowZoneRoles && role.organizationId === null);

        const mismatched = roles.filter(outOfScope).map((r) => r.id);
        if (mismatched.length > 0) {
            throw new InvalidInputError(`Roles not assignable in this user's scope: ${mismatched.join(', ')}`);
        }
    }

    async findByIdWithRoles(id: User['id']): Promise<UserWithRoles | undefined> {
        const rawUser = await this.db.query.usersTable.findFirst({
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: {
                    with: {
                        role: true
                    }
                },
                wallets: {
                    where: (f, { isNull }) => isNull(f.deletedAt)
                }
            },
            where: eq(usersTable.id, id)
        });

        if (rawUser === undefined) {
            return undefined;
        }

        return {
            ...rawUser,
            roles: rawUser.roles.map((r) => r.role)
        };
    }

    async findById(id: User['id']): Promise<User | undefined> {
        const rawUser = await this.db.query.usersTable.findFirst({
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: true } },
                wallets: {
                    where: (f, { isNull }) => isNull(f.deletedAt)
                }
            },
            where: eq(usersTable.id, id)
        });
        if (rawUser === undefined) {
            return undefined;
        }
        return { ...rawUser, roles: rawUser.roles.map((r) => r.role) };
    }

    async findByAddress(address: Address): Promise<User | undefined> {
        const user = await this.db.query.walletsTable.findFirst({
            where: (t, { eq, and, isNull }) => and(eq(t.walletAddress, address), isNull(t.deletedAt)),
            columns: { userId: true }
        });

        if (user === undefined) {
            return undefined;
        }

        return this.findById(user.userId);
    }

    async findByAddressWithRoles(address: Address): Promise<UserWithRoles | undefined> {
        const wallet = await this.db.query.walletsTable.findFirst({
            where: (t, { eq, and, isNull }) => and(eq(t.walletAddress, address), isNull(t.deletedAt)),
            columns: { userId: true }
        });

        if (wallet === undefined) {
            return undefined;
        }

        return this.findByIdWithRoles(wallet.userId);
    }

    async findByOidcSub(sub: NonNullable<User['oidcSub']>): Promise<User | undefined> {
        const rawUser = await this.db.query.usersTable.findFirst({
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: true } },
                wallets: {
                    where: (f, { isNull }) => isNull(f.deletedAt)
                }
            },
            where: eq(usersTable.oidcSub, sub)
        });
        if (rawUser === undefined) {
            return undefined;
        }
        return { ...rawUser, roles: rawUser.roles.map((r) => r.role) };
    }

    async findByIssuerAndSub(
        issuer: NonNullable<User['oidcIssuer']>,
        sub: NonNullable<User['oidcSub']>
    ): Promise<User | undefined> {
        const rawUser = await this.db.query.usersTable.findFirst({
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: true } },
                wallets: {
                    where: (f, { isNull }) => isNull(f.deletedAt)
                }
            },
            where: and(eq(usersTable.oidcIssuer, issuer), eq(usersTable.oidcSub, sub))
        });
        if (rawUser === undefined) {
            return undefined;
        }
        return { ...rawUser, roles: rawUser.roles.map((r) => r.role) };
    }

    async backfillMissingOidcIssuer(issuer: string): Promise<void> {
        await this.db
            .update(usersTable)
            .set({ oidcIssuer: issuer })
            .where(and(eq(usersTable.source, UserSources.enum.oidc), isNull(usersTable.oidcIssuer)));
    }

    async setOidcIssuer(userId: User['id'], issuer: string): Promise<void> {
        await this.db.update(usersTable).set({ oidcIssuer: issuer }).where(eq(usersTable.id, userId));
    }

    async update(userId: User['id'], user: UpdateUser, roleScope?: RoleScopeOptions) {
        return await this.transaction(async (tx) => {
            const existingUser = await this.findById(userId);
            if (!existingUser) {
                throw new EntityNotFound('User', { id: userId });
            }

            if (user.displayName !== undefined || user.oidcSub !== undefined) {
                const { displayName, oidcSub } = user;
                await tx.update(usersTable).set({ displayName, oidcSub }).where(eq(usersTable.id, userId));
            }

            // Update roles if provided
            if (user.roles !== undefined) {
                await this.assertRolesMatchOrganization(tx, user.roles, existingUser.organizationId, roleScope);
                // Remove existing roles
                await tx.delete(userRolesTable).where(eq(userRolesTable.userId, userId));

                // Add new roles if any
                const roles = user.roles;
                if (roles && roles.length > 0) {
                    // Insert new user roles
                    await tx.insert(userRolesTable).values(
                        roles.map((roleId) => ({
                            userId,
                            roleId
                        }))
                    );
                }
            }

            // Avoid wallet update for tenant users
            const walletsAreChanging =
                user.wallets &&
                user.wallets.length > 0 &&
                this.walletsAreChanging(
                    user.wallets,
                    existingUser.wallets.map((w) => w.walletAddress)
                );

            if (existingUser.source === UserSources.enum.tenant && walletsAreChanging) {
                throw new InvalidInputError('Addresses of tenant users cannot be modified via admin api');
            }

            // Update wallet addresses if provided
            if (user.wallets !== undefined) {
                // Soft delete existing wallet assignments
                await tx.update(walletsTable).set({ deletedAt: new Date() }).where(eq(walletsTable.userId, userId));

                // Add new wallet assignments if any
                if (user.wallets.length > 0) {
                    try {
                        await tx
                            .insert(walletsTable)
                            .values(user.wallets.map((walletAddress) => ({ userId, walletAddress })));
                    } catch (err) {
                        if (isUniqueConstraintError(err)) {
                            throw new EntityAlreadyExistsError('Wallet is associated with another user');
                        }
                        throw err;
                    }
                }
            }

            // Return updated user with roles and wallets
            const updatedUser = await tx.query.usersTable.findFirst({
                with: {
                    organization: { columns: USER_ORGANIZATION_COLUMNS },
                    roles: { with: { role: true } },
                    wallets: {
                        where: (f, { isNull }) => isNull(f.deletedAt)
                    }
                },
                where: eq(usersTable.id, userId)
            });
            if (!updatedUser) {
                throw new InvalidInputError('User was not found');
            }

            return { ...updatedUser, roles: updatedUser.roles.map((r) => r.role) };
        });
    }

    private walletsAreChanging(list1: Hex[], list2: Hex[]) {
        let areEqual = list1.length === list2.length;

        if (!areEqual) return true;

        const sorted1 = list1.map((i) => i.toLowerCase()).sort();
        const sorted2 = list2.map((i) => i.toLowerCase()).sort();

        for (let i = 0; i < sorted1.length; i++) {
            areEqual = areEqual && sorted1[i] === sorted2[i];
        }

        return !areEqual;
    }

    async delete(userId: User['id']) {
        const userToDelete = await this.findById(userId);
        if (!userToDelete) {
            return false;
        }

        return await this.transaction(async (tx) => {
            const [deletedUser] = await tx.delete(usersTable).where(eq(usersTable.id, userId)).returning();
            return !!deletedUser;
        });
    }

    /**
     * Zone-level users by default. `scope: 'all'` adds organization members, `organizationId` narrows to
     * one organization; members of a soft-deleted organization are never listed, since nothing can be
     * done with them. `sort: 'organization'` lists zone users before members, grouped by organization.
     */
    async findPaginated({
        limit,
        offset,
        roleId,
        displayName,
        scope = 'zone',
        organizationId,
        sort = 'created'
    }: PaginationParams & {
        roleId?: string;
        displayName?: string;
        scope?: 'zone' | 'all';
        organizationId?: string;
        sort?: 'created' | 'organization';
    }) {
        const liveOrganizationIds = this.db
            .select({ id: organizationsTable.id })
            .from(organizationsTable)
            .where(isNull(organizationsTable.deletedAt));

        const usersWithRole = this.db
            .select({ id: userRolesTable.userId })
            .from(userRolesTable)
            .where(eq(userRolesTable.roleId, roleId ?? ''));

        const scoped =
            organizationId !== undefined
                ? eq(usersTable.organizationId, organizationId)
                : scope === 'zone'
                  ? isNull(usersTable.organizationId)
                  : undefined;

        const filter = and(
            scoped,
            // A member is listable only while their organization is live; zone users have none.
            or(isNull(usersTable.organizationId), inArray(usersTable.organizationId, liveOrganizationIds)),
            roleId ? inArray(usersTable.id, usersWithRole) : undefined,
            displayName ? like(usersTable.displayName, `%${displayName}%`) : undefined
        );

        const { count: totalItems } = await this.db
            .select({ count: count() })
            .from(usersTable)
            .where(filter)
            .then(getFirstOrThrow);

        const users = await this.db.query.usersTable.findMany({
            where: filter,
            limit,
            offset,
            orderBy: (t, { asc, sql }) =>
                sort === 'organization'
                    ? [sql`${t.organizationId} asc nulls first`, asc(t.createdAt), asc(t.id)]
                    : [asc(t.createdAt), asc(t.id)],
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: { with: { role: true } },
                wallets: { where: (f, { isNull }) => isNull(f.deletedAt) }
            }
        });

        return {
            items: users.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) })),
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalItems / limit),
                totalItems,
                limit,
                offset
            }
        } satisfies PaginatedResult<User>;
    }

    async releaseWalletsByOrganizationId(organizationId: string): Promise<number> {
        const members = this.db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.organizationId, organizationId));

        const released = await this.db
            .update(walletsTable)
            .set({ deletedAt: new Date() })
            .where(and(isNull(walletsTable.deletedAt), inArray(walletsTable.userId, members)))
            .returning({ id: walletsTable.id });

        return released.length;
    }

    async organizationIdByIds(ids: string[]): Promise<Map<string, string | null>> {
        if (ids.length === 0) return new Map();
        const rows = await this.db
            .select({ id: usersTable.id, organizationId: usersTable.organizationId })
            .from(usersTable)
            .where(inArray(usersTable.id, ids));
        return new Map(rows.map((row) => [row.id, row.organizationId]));
    }

    async checkUserAddress(userId: string, address: Address) {
        const result = await this.db.query.walletsTable.findFirst({
            where: and(
                eq(walletsTable.userId, userId),
                eq(walletsTable.walletAddress, address),
                isNull(walletsTable.deletedAt)
            ),
            columns: {
                walletAddress: true
            }
        });
        return result !== undefined;
    }

    async getWalletToken(userId: string): Promise<string | null> {
        const user = await this.db.query.usersTable.findFirst({
            where: eq(usersTable.id, userId),
            columns: {
                walletToken: true
            }
        });
        if (!user) {
            throw new EntityNotFound('User', { id: userId });
        }
        return user.walletToken;
    }

    async storeWalletToken(userId: string, token: string): Promise<void> {
        const [updated] = await this.db
            .update(usersTable)
            .set({
                walletToken: token
            })
            .where(eq(usersTable.id, userId))
            .returning({ id: usersTable.id });

        if (!updated) {
            throw new EntityNotFound('User', { id: userId });
        }
    }

    async invalidateWalletToken(userId: string): Promise<void> {
        const [updated] = await this.db
            .update(usersTable)
            .set({
                walletToken: null
            })
            .where(eq(usersTable.id, userId))
            .returning({ id: usersTable.id });

        if (!updated) {
            throw new EntityNotFound('User', { id: userId });
        }
    }

    async getByWalletToken(token: string): Promise<UserWithRoles | undefined> {
        const findFirst = await this.db.query.usersTable.findFirst({
            with: {
                organization: { columns: USER_ORGANIZATION_COLUMNS },
                roles: {
                    with: {
                        role: true
                    }
                },
                wallets: {
                    where: (f, { isNull }) => isNull(f.deletedAt)
                }
            },
            where: eq(usersTable.walletToken, token)
        });
        // Wallet tokens are independent credentials that outlive session revocation.
        if (findFirst === undefined || belongsToDeletedOrganization(findFirst)) {
            return undefined;
        }

        return {
            ...findFirst,
            roles: findFirst.roles.map((r) => r.role)
        };
    }

    async walletExistInSystem(address: Address): Promise<boolean> {
        return this.db.query.walletsTable
            .findFirst({
                columns: { id: true },
                where: (f, { eq }) => eq(f.walletAddress, address)
            })
            .then((record) => record !== undefined);
    }
}
