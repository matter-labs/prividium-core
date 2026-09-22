import type { Permission } from '@repo/access-control';
import type { AddressClass, CoreFacts, CoreReferences, MethodSelector, SigningIdentity } from '@repo/api-kit';
import { and, arrayContains, eq, inArray, isNull, or } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AbiFunction, Address } from 'viem';
import type { Repositories } from '../db';
import {
    contractsTable,
    m2mApplicationsOrganizationsTable,
    m2mApplicationsTable,
    m2mAppRolesTable,
    rolesTable,
    userRolesTable,
    usersTable,
    walletsTable
} from '../db/schema';
import { getFirst } from '../db/utils';
import { resolveAbiItem } from '../utils/abi';

export class RepositoriesCoreFacts implements CoreFacts {
    private repos: Repositories;
    private multiOrgEnabled: boolean;

    constructor({ repos, multiOrgEnabled = false }: { repos: Repositories; multiOrgEnabled?: boolean }) {
        this.repos = repos;
        this.multiOrgEnabled = multiOrgEnabled;
    }

    /**
     * What the zone's `null` scope reaches. With organizations off the zone governs every
     * signer, a wallet still carrying an organization from before the switch included, so
     * its facts have to span the whole deployment: scoped to rows naming no organization,
     * an org-owned contract classifies as `unknown` and a rule that blocks on
     * classification silently allows it. With organizations on the zone surface is
     * unavailable, so a `null` reaching here is not a scope to widen -- it stays exact.
     */
    private scope(column: PgColumn, organizationId: string | null, inherits = false) {
        if (organizationId !== null) {
            return inherits ? or(eq(column, organizationId), isNull(column)) : eq(column, organizationId);
        }
        return this.multiOrgEnabled ? isNull(column) : undefined;
    }

    private get db() {
        return this.repos.db;
    }

    async identityForAddress(address: Address): Promise<SigningIdentity | undefined> {
        const user = await this.repos.users.findByAddressWithRoles(address);
        return user === undefined
            ? undefined
            : { id: user.id, organizationId: user.organizationId, roleIds: user.roles.map((role) => role.id) };
    }

    async classifyAddress(organizationId: string | null, address: Address): Promise<AddressClass> {
        const [contract, wallet] = await Promise.all([
            this.db
                .select({ address: contractsTable.contractAddress })
                .from(contractsTable)
                .where(
                    and(
                        eq(contractsTable.contractAddress, address),
                        this.scope(contractsTable.organizationId, organizationId, true)
                    )
                )
                .limit(1)
                .then(getFirst),
            // Scoped to this organization's members, as the contract branch is: a rule
            // reading `wallet` as "one of ours" would otherwise also admit every other
            // organization's wallets.
            this.db
                .select({ id: walletsTable.id })
                .from(walletsTable)
                .innerJoin(usersTable, eq(usersTable.id, walletsTable.userId))
                .where(
                    and(
                        eq(walletsTable.walletAddress, address),
                        isNull(walletsTable.deletedAt),
                        this.scope(usersTable.organizationId, organizationId)
                    )
                )
                .limit(1)
                .then(getFirst)
        ]);

        if (contract !== undefined) {
            return 'contract';
        }
        return wallet === undefined ? 'unknown' : 'wallet';
    }

    /**
     * Address alone, as the RPC gate resolves an ABI today, unlike org-scoped
     * `classifyAddress`.
     */
    async abiFor(contractAddress: Address, selector: MethodSelector): Promise<AbiFunction | undefined> {
        const contract = await this.db.query.contractsTable.findFirst({
            where: (f, { eq: is }) => is(f.contractAddress, contractAddress),
            columns: { abi: true, templateId: true }
        });

        if (contract === undefined) {
            return undefined;
        }

        try {
            const [item] = await resolveAbiItem(
                contract.abi,
                async () => {
                    const { templateId } = contract;
                    if (templateId === null) {
                        return undefined;
                    }
                    const template = await this.db.query.contractTemplatesTable.findFirst({
                        where: (f, { eq: is }) => is(f.id, templateId),
                        columns: { abi: true }
                    });
                    return template?.abi;
                },
                selector
            );
            return item?.type === 'function' ? item : undefined;
        } catch {
            // `resolveAbiItem` throws for a contract with no ABI, an unparseable
            // stored ABI, and a selector present in neither ABI. All three are "the
            // core cannot name this method", which the interface reports as absence
            // so the caller keeps its own error vocabulary.
            return undefined;
        }
    }

    async referencesFor(organizationId: string | null): Promise<CoreReferences> {
        const [roles, users, ownedApps, sharedApps, contracts] = await Promise.all([
            this.db
                .select({ id: rolesTable.id })
                .from(rolesTable)
                .where(this.scope(rolesTable.organizationId, organizationId)),
            this.db
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(this.scope(usersTable.organizationId, organizationId)),
            this.db
                .select({ id: m2mApplicationsTable.id })
                .from(m2mApplicationsTable)
                .where(this.scope(m2mApplicationsTable.ownerOrganizationId, organizationId)),
            // An organization's shared apps are named by a membership row; the zone has none.
            organizationId === null
                ? Promise.resolve([])
                : this.db
                      .select({ id: m2mApplicationsOrganizationsTable.m2mAppId })
                      .from(m2mApplicationsOrganizationsTable)
                      .where(eq(m2mApplicationsOrganizationsTable.organizationId, organizationId)),
            this.db
                .select({ address: contractsTable.contractAddress })
                .from(contractsTable)
                .where(this.scope(contractsTable.organizationId, organizationId, true))
        ]);

        const roleIds = roles.map((role) => role.id);

        return {
            roleIds: new Set(roleIds),
            userIds: new Set(users.map((user) => user.id)),
            m2mAppIds: new Set([...ownedApps, ...sharedApps].map((app) => app.id)),
            contractAddresses: contracts.map((contract) => contract.address),
            roleMemberCounts: await this.countRoleMembers(roleIds)
        };
    }

    private async countRoleMembers(roleIds: string[]): Promise<Map<string, number>> {
        if (roleIds.length === 0) {
            return new Map();
        }

        // Through `holdersByRole`, which unions users and machine identities: a role
        // held only by machines would otherwise count zero and make an approval group
        // naming it permanently unpublishable.
        const holders = await this.holdersByRole(roleIds);
        return new Map(roleIds.map((id) => [id, holders.get(id)?.length ?? 0]));
    }

    async holdersByRole(roleIds: readonly string[]): Promise<Map<string, string[]>> {
        const members = new Map<string, string[]>(roleIds.map((id) => [id, []]));
        if (roleIds.length === 0) {
            return members;
        }

        const ids = [...roleIds];
        const [users, apps] = await Promise.all([
            this.db
                .select({ roleId: userRolesTable.roleId, holderId: userRolesTable.userId })
                .from(userRolesTable)
                .where(inArray(userRolesTable.roleId, ids)),
            this.db
                .select({ roleId: m2mAppRolesTable.roleId, holderId: m2mAppRolesTable.m2mAppId })
                .from(m2mAppRolesTable)
                .where(inArray(m2mAppRolesTable.roleId, ids))
        ]);

        for (const { roleId, holderId } of [...users, ...apps]) {
            members.get(roleId)?.push(holderId);
        }
        return members;
    }

    async userHoldersOfRoles(roleIds: readonly string[]): Promise<string[]> {
        if (roleIds.length === 0) {
            return [];
        }

        const rows = await this.db
            .selectDistinct({ userId: userRolesTable.userId })
            .from(userRolesTable)
            .where(inArray(userRolesTable.roleId, [...roleIds]));

        return rows.map((row) => row.userId);
    }

    async rolesWithPermission(organizationId: string | null, permission: Permission): Promise<string[]> {
        const rows = await this.db
            .select({ id: rolesTable.id })
            .from(rolesTable)
            .where(
                and(
                    this.scope(rolesTable.organizationId, organizationId, true),
                    arrayContains(rolesTable.systemPermissions, [permission])
                )
            );

        return rows.map((row) => row.id);
    }

    async zoneRolesWithPermission(permission: Permission): Promise<string[]> {
        const rows = await this.db
            .select({ id: rolesTable.id })
            .from(rolesTable)
            .where(and(isNull(rolesTable.organizationId), arrayContains(rolesTable.systemPermissions, [permission])));

        return rows.map((row) => row.id);
    }

    async findOrgAdminRole(organizationId: string | null): Promise<{ id: string } | undefined> {
        const role =
            organizationId === null
                ? await this.repos.roles.findZoneAdminRole()
                : await this.repos.roles.findOrgAdminRole(organizationId);
        return role === undefined ? undefined : { id: role.id };
    }
}
