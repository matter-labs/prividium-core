import { ADMIN_ROLE_ID } from '@repo/access-control';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import type { TxType } from '../db';
import {
    rolesTable,
    tenantsDefaultRoles,
    tenantsTable,
    tenantsUsers,
    UserSources,
    usersTable,
    walletsTable
} from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { EntityNotFound, InvalidInputError } from '../utils/error-types';
import { fetchChunked } from '../utils/fetch-chunked';
import { hexListIncludes } from '../utils/hex';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';
import type { BareRole, Role } from './roles-repository';

export type Tenant = typeof tenantsTable.$inferSelect & { defaultRoles: BareRole[] };
export type TenantWithRoles = typeof tenantsTable.$inferSelect & { defaultRoles: Role[] };

export type InsertTenant = typeof tenantsTable.$inferInsert & {
    defaultRoles: Pick<Role, 'id'>[];
};

export type TenantUser = {
    id: string;
    walletAddresses: { walletAddress: Address }[];
    displayName: string;
};

export type InsertTenantUser = Omit<TenantUser, 'id'>;

export class TenantsRepository extends BaseRepository {
    async create(data: InsertTenant): Promise<Tenant> {
        const { defaultRoles, ...tenantFields } = data;

        return this.transaction(async (tx) => {
            const newTenant = await tx
                .insert(tenantsTable)
                .values({
                    ...tenantFields
                })
                .returning()
                .then(getFirstOrThrow);

            const createdDefaultRoles = await this.associateRoles(defaultRoles, newTenant.id, tx);

            const createdTenant = {
                ...newTenant,
                defaultRoles: createdDefaultRoles
            };

            return createdTenant;
        });
    }

    async searchPaginated({ limit, offset }: PaginationParams): Promise<PaginatedResult<Tenant>> {
        const { count: countResult } = await this.db
            .select({ count: count() })
            .from(tenantsTable)
            .then(getFirstOrThrow);

        const rows = await this.db.query.tenantsTable.findMany({
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

    async findByPublicKey(publicKey: Address): Promise<Tenant | undefined> {
        const tenant = await this.db.query.tenantsTable.findFirst({
            where: (t, { eq }) => eq(t.publicKey, publicKey),
            with: {
                defaultRoles: {
                    with: { role: { columns: { id: true, roleName: true } } }
                }
            }
        });
        if (tenant === undefined) {
            return undefined;
        }
        return { ...tenant, defaultRoles: tenant.defaultRoles.map((dr) => dr.role) };
    }

    async getById(id: string): Promise<Tenant> {
        const first = await this.db.query.tenantsTable.findFirst({
            where: (t, { eq }) => eq(t.id, id),
            with: {
                defaultRoles: {
                    with: { role: { columns: { id: true, roleName: true } } }
                }
            }
        });

        if (first === undefined) {
            throw new EntityNotFound('Tenant', { id });
        }

        return { ...first, defaultRoles: first.defaultRoles.map((dr) => dr.role) };
    }

    async getByIdWithRoles(id: string): Promise<TenantWithRoles> {
        const first = await this.db.query.tenantsTable.findFirst({
            where: (t, { eq }) => eq(t.id, id),
            with: {
                defaultRoles: {
                    with: {
                        role: true
                    }
                }
            }
        });

        if (first === undefined) {
            throw new EntityNotFound('Tenant', { id });
        }

        return {
            ...first,
            defaultRoles: first.defaultRoles.map((r) => r.role)
        };
    }

    async update(
        id: string,
        newData: Pick<Tenant, 'name' | 'publicKey'> & Pick<InsertTenant, 'defaultRoles'>
    ): Promise<Tenant> {
        const { publicKey, name, defaultRoles } = newData;

        return this.transaction(async (tx) => {
            const existing = await tx.repositories().tenants.getById(id);

            const newRoleIds = defaultRoles.map((r) => r.id);

            const rolesToDelete = existing.defaultRoles
                .filter((role) => !newRoleIds.includes(role.id))
                .map((r) => r.id);
            if (rolesToDelete.length > 0) {
                await tx
                    .delete(tenantsDefaultRoles)
                    .where(
                        and(
                            eq(tenantsDefaultRoles.tenantId, existing.id),
                            inArray(tenantsDefaultRoles.roleId, rolesToDelete)
                        )
                    );
            }

            const existingRoleIds = existing.defaultRoles.map((r) => r.id);
            const rolesToCreate = defaultRoles.filter((r) => !existingRoleIds.includes(r.id));
            await this.associateRoles(rolesToCreate, existing.id, tx);

            await tx.update(tenantsTable).set({ publicKey, name }).where(eq(tenantsTable.id, id)).returning();

            return tx.repositories().tenants.getById(id);
        });
    }

    async delete(id: string): Promise<void> {
        return await this.transaction(async (tx) => {
            const returning = await tx.delete(tenantsTable).where(eq(tenantsTable.id, id)).returning();
            if (returning.length === 0) {
                throw new EntityNotFound('Tenant', { id });
            }
        });
    }

    private async associateRoles(
        roles: InsertTenant['defaultRoles'],
        tenanId: string,
        tx: TxType
    ): Promise<Tenant['defaultRoles']> {
        if (roles.length === 0) {
            return [];
        }

        const roleIds = roles.map((r) => r.id);
        const existingRoles = await tx.query.rolesTable.findMany({
            columns: { id: true, roleName: true },
            where: inArray(rolesTable.id, roleIds)
        });
        const existingRoleIds = new Set(existingRoles.map((r) => r.id));
        const missingRoles = roleIds.filter((id) => !existingRoleIds.has(id));
        if (missingRoles.length > 0) {
            throw new EntityNotFound('Role', { id: missingRoles.join(',') });
        }

        // Default roles are stamped onto every new tenant user, so the zone admin role must never
        // be auto-granted this way.
        if (existingRoleIds.has(ADMIN_ROLE_ID)) {
            throw new InvalidInputError(`Role "${ADMIN_ROLE_ID}" cannot be a default tenant role`);
        }

        await tx.insert(tenantsDefaultRoles).values(roleIds.map((roleId) => ({ tenantId: tenanId, roleId })));
        return existingRoles;
    }

    async createUser(tenantId: string, userData: InsertTenantUser): Promise<TenantUser> {
        return this.transaction(async (tx) => {
            const existing = await tx.repositories().tenants.getById(tenantId);

            const user = await tx.repositories().users.create({
                source: UserSources.enum.tenant,
                displayName: userData.displayName,
                wallets: userData.walletAddresses.map((w) => w.walletAddress),
                roles: existing.defaultRoles.map((r) => r.id)
            });

            await tx.insert(tenantsUsers).values({
                userId: user.id,
                tenantId: existing.id
            });

            return {
                id: user.id,
                walletAddresses: user.wallets,
                displayName: user.displayName
            };
        });
    }

    async allAssociatedWallets(tenantId: string): Promise<Hex[]> {
        const rows = await this.db
            .select({ address: walletsTable.walletAddress })
            .from(walletsTable)
            .innerJoin(usersTable, eq(usersTable.id, walletsTable.userId))
            .innerJoin(tenantsUsers, eq(tenantsUsers.userId, usersTable.id))
            .where(and(eq(tenantsUsers.tenantId, tenantId), isNull(walletsTable.deletedAt)));

        return rows.map(({ address }) => address);
    }

    async associatedWalletsAmong(tenantId: string, candidates: Hex[]): Promise<Hex[]> {
        const rows = await fetchChunked(candidates, (chunk) =>
            this.db
                .select({ address: walletsTable.walletAddress })
                .from(walletsTable)
                .innerJoin(usersTable, eq(usersTable.id, walletsTable.userId))
                .innerJoin(tenantsUsers, eq(tenantsUsers.userId, usersTable.id))
                .where(
                    and(
                        eq(tenantsUsers.tenantId, tenantId),
                        inArray(walletsTable.walletAddress, chunk),
                        isNull(walletsTable.deletedAt)
                    )
                )
        );

        return rows.map(({ address }) => address);
    }

    async isAddressAssociatedToTenant(tenantId: string, address: Hex): Promise<boolean> {
        const { res } = await this.db
            .select({ res: count() })
            .from(tenantsUsers)
            .innerJoin(walletsTable, eq(tenantsUsers.userId, walletsTable.userId))
            .where(
                and(
                    eq(walletsTable.walletAddress, address),
                    eq(tenantsUsers.tenantId, tenantId),
                    isNull(walletsTable.deletedAt)
                )
            )
            .then(getFirstOrThrow);

        return res !== 0;
    }

    async usersFor(tenantId: string, { offset, limit }: PaginationParams): Promise<PaginatedResult<TenantUser>> {
        const rows = await this.db
            .select({
                userId: tenantsUsers.userId,
                displayName: usersTable.displayName,
                walletAddress: walletsTable.walletAddress
            })
            .from(tenantsUsers)
            .innerJoin(usersTable, eq(usersTable.id, tenantsUsers.userId))
            .leftJoin(walletsTable, and(isNull(walletsTable.deletedAt), eq(walletsTable.userId, usersTable.id)))
            .offset(offset)
            .limit(limit)
            .orderBy(asc(tenantsUsers.createdAt), asc(tenantsUsers.userId))
            .where(eq(tenantsUsers.tenantId, tenantId));

        const userMap = new Map<string, TenantUser>();
        for (const row of rows) {
            let tenantUser = userMap.get(row.userId);
            if (tenantUser === undefined) {
                tenantUser = { id: row.userId, displayName: row.displayName, walletAddresses: [] };
                userMap.set(row.userId, tenantUser);
            }
            if (row.walletAddress) {
                tenantUser.walletAddresses.push({ walletAddress: row.walletAddress });
            }
        }

        const { count: countResult } = await this.db
            .select({ count: count() })
            .from(tenantsUsers)
            .where(eq(tenantsUsers.tenantId, tenantId))
            .then(getFirstOrThrow);

        return {
            items: [...userMap.values()],
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(countResult / limit),
                totalItems: countResult,
                limit,
                offset
            }
        };
    }

    async addWalletsToUser(
        tenantId: string,
        userId: string,
        walletsToAdd: { walletAddress: `0x${string}` }[]
    ): Promise<TenantUser> {
        return this.transaction(async (tx) => {
            const existingTenant = await tx.repositories().tenants.getById(tenantId);

            const association = await tx.query.tenantsUsers.findFirst({
                where: (t, { and, eq }) => and(eq(t.tenantId, existingTenant.id), eq(t.userId, userId))
            });

            if (association === undefined) {
                throw new EntityNotFound('User', { id: userId });
            }

            const existingUser = await tx.repositories().users.findById(association.userId);
            if (existingUser === undefined) {
                throw new EntityNotFound('User', { id: userId });
            }

            const existingWallets = existingUser.wallets.map((w) => w.walletAddress);
            const rawWallets = walletsToAdd.map((w) => w.walletAddress);
            const newWallets = rawWallets.filter((w) => !hexListIncludes(existingWallets, w));

            if (newWallets.length > 0) {
                await tx.insert(walletsTable).values(
                    newWallets.map((w) => ({
                        userId: existingUser.id,
                        walletAddress: w
                    }))
                );
            }

            const updatedWallets = [...existingWallets, ...newWallets];
            return {
                id: userId,
                displayName: existingUser.displayName,
                walletAddresses: updatedWallets.map((w) => ({ walletAddress: w }))
            };
        });
    }
}
