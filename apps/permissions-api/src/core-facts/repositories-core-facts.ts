import type { Permission } from '@repo/access-control';
import type { AddressClass, CoreFacts, CoreReferences, MethodSelector, SigningIdentity } from '@repo/api-kit';
import { and, arrayContains, eq, inArray, isNull, or } from 'drizzle-orm';
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

    constructor({ repos }: { repos: Repositories }) {
        this.repos = repos;
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

    async classifyAddress(organizationId: string, address: Address): Promise<AddressClass> {
        const [contract, wallet] = await Promise.all([
            this.db
                .select({ address: contractsTable.contractAddress })
                .from(contractsTable)
                .where(
                    and(
                        eq(contractsTable.contractAddress, address),
                        or(eq(contractsTable.organizationId, organizationId), isNull(contractsTable.organizationId))
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
                        eq(usersTable.organizationId, organizationId)
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

    async referencesFor(organizationId: string): Promise<CoreReferences> {
        const [roles, users, ownedApps, sharedApps, contracts] = await Promise.all([
            this.db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.organizationId, organizationId)),
            this.db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.organizationId, organizationId)),
            this.db
                .select({ id: m2mApplicationsTable.id })
                .from(m2mApplicationsTable)
                .where(eq(m2mApplicationsTable.ownerOrganizationId, organizationId)),
            this.db
                .select({ id: m2mApplicationsOrganizationsTable.m2mAppId })
                .from(m2mApplicationsOrganizationsTable)
                .where(eq(m2mApplicationsOrganizationsTable.organizationId, organizationId)),
            this.db
                .select({ address: contractsTable.contractAddress })
                .from(contractsTable)
                .where(or(eq(contractsTable.organizationId, organizationId), isNull(contractsTable.organizationId)))
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

    async rolesWithPermission(organizationId: string, permission: Permission): Promise<string[]> {
        const rows = await this.db
            .select({ id: rolesTable.id })
            .from(rolesTable)
            .where(
                and(
                    or(eq(rolesTable.organizationId, organizationId), isNull(rolesTable.organizationId)),
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

    async findOrgAdminRole(organizationId: string): Promise<{ id: string } | undefined> {
        const role = await this.repos.roles.findOrgAdminRole(organizationId);
        return role === undefined ? undefined : { id: role.id };
    }
}
