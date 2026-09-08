import { createHash } from 'node:crypto';
import { type Address, type Hex, pad } from 'viem';
import { z } from 'zod/v4';
import type { Repositories } from '../db';
import { topicConditionEnum } from '../db/schema';
import type { BarePermission } from '../repositories/contract-events-permissions-repository';
import type { GetLogsFilter } from '../rpc/methods/handlers';
import { EntityNotFound } from '../utils/error-types';
import { areHexEqual } from '../utils/hex';
import { hexSizedSchema } from '../utils/schemas/hex-schema';
import { stableStringify } from '../utils/stable-stringify';

export const eventDefinitionSchema = z.object({
    contractAddress: hexSizedSchema(20),
    topic0: hexSizedSchema(32).optional(),
    topic1: hexSizedSchema(32).optional(),
    topic2: hexSizedSchema(32).optional(),
    topic3: hexSizedSchema(32).optional()
});

export type EventDefinition = z.infer<typeof eventDefinitionSchema>;

const topicConditionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(topicConditionEnum.enum.equalTo), value: hexSizedSchema(32) }),
    z.object({ type: z.literal(topicConditionEnum.enum.userAddress) })
]);

export const eventPermissionRuleSchema = z.object({
    contractAddress: hexSizedSchema(20),
    topic0: hexSizedSchema(32).nullable(),
    topic1: topicConditionSchema.nullable(),
    topic2: topicConditionSchema.nullable(),
    topic3: topicConditionSchema.nullable()
});

export type EventPermissionRule = z.infer<typeof eventPermissionRuleSchema>;

export const rulesSchema = eventPermissionRuleSchema.array();

// This must change with schema changes so consumers can either update logic or deny unknown rules to avoid leaks.
export const RULES_FINGERPRINT = createHash('sha256').update(stableStringify(rulesSchema.toJSONSchema())).digest('hex');

type Check = { type: 'equalTo' | 'userAddress' | 'none'; value: Hex | null };

/**
 * The principal reading events. `wallets` is the default `userAddress` topic context.
 * `linkedOrgWallets` marks an M2M reader, scoped per linked organization.
 */
export type EventReader = {
    roleIds: string[];
    wallets: Hex[];
    organizationId: string | null;
    linkedOrgWallets?: Map<string, Address[]>;
};

export class EventPermissionVerifier {
    private repos: Repositories;
    readonly multiOrgEnabled: boolean;

    constructor(repos: Repositories, multiOrgEnabled: boolean) {
        this.repos = repos;
        this.multiOrgEnabled = multiOrgEnabled;
    }

    async getRules(userId: string): Promise<EventPermissionRule[]> {
        const user = await this.repos.users.findById(userId);
        if (user === undefined) {
            throw new EntityNotFound('User', { id: userId });
        }
        const roleIds = user.roles.map((r) => r.id);
        if (roleIds.length === 0) {
            return [];
        }
        const permissions = await this.repos.contractEventsPermissions.searchForRoles(roleIds);
        const contractOrgs = await this.contractOrganizations(permissions.map((p) => p.contractAddress));

        return permissions
            .filter(
                (p) =>
                    this.walletContextFor(
                        { roleIds, wallets: [], organizationId: user.organizationId },
                        p,
                        contractOrgs.get(p.contractAddress.toLowerCase()) ?? null
                    ) !== null
            )
            .map((p) => this.toRule(p));
    }

    private toRule(p: BarePermission): EventPermissionRule {
        const topicCondition = (conditionType: string | null, constant: Hex | null): EventPermissionRule['topic1'] => {
            if (conditionType === topicConditionEnum.enum.equalTo && constant) {
                return { type: 'equalTo', value: constant };
            }
            if (conditionType === topicConditionEnum.enum.userAddress) {
                return { type: 'userAddress' };
            }
            return null;
        };

        return {
            contractAddress: p.contractAddress,
            topic0: p.topic0Constant ?? null,
            topic1: topicCondition(p.topic1ConditionType, p.topic1Constant),
            topic2: topicCondition(p.topic2ConditionType, p.topic2Constant),
            topic3: topicCondition(p.topic3ConditionType, p.topic3Constant)
        };
    }

    async checkMany(
        reader: EventReader,
        events: EventDefinition[],
        orgAddresses: Address[] = [],
        knownContractOrgs?: Map<string, string | null>
    ): Promise<boolean[]> {
        if (reader.roleIds.length === 0) {
            return events.map(() => false);
        }

        const uniqueContractAddresses = [...new Set(events.map((e) => e.contractAddress))];
        const [permissions, contractOrgs] = await Promise.all([
            this.repos.contractEventsPermissions.searchForContractAndRoles(uniqueContractAddresses, reader.roleIds),
            knownContractOrgs ?? this.contractOrganizations(uniqueContractAddresses)
        ]);
        const permissionsPerContract = new PermissionsPerContractMap(permissions);

        return events.map((e) =>
            this.verifyOneLog(reader, e, permissionsPerContract.get(e.contractAddress), contractOrgs, orgAddresses)
        );
    }

    private async contractOrganizations(addresses: Address[]): Promise<Map<string, string | null>> {
        if (!this.multiOrgEnabled) {
            return new Map();
        }
        return this.repos.contracts.organizationIdsByAddresses([...new Set(addresses)]);
    }

    /**
     * Wallet context for one permission, or null when org-only scoping excludes it.
     * Mirrors `decidePermission` step 7.
     */
    private walletContextFor(
        reader: EventReader,
        permission: BarePermission,
        contractOrg: string | null
    ): Hex[] | null {
        if (!this.multiOrgEnabled || contractOrg === null || !permission.organizationOnly) {
            return reader.wallets;
        }
        if (reader.linkedOrgWallets) {
            return reader.linkedOrgWallets.get(contractOrg) ?? null;
        }
        return reader.organizationId === contractOrg ? reader.wallets : null;
    }

    private verifyOneLog(
        reader: EventReader,
        definition: EventDefinition,
        permissions: BarePermission[],
        contractOrgs: Map<string, string | null>,
        orgAddresses: Address[] = []
    ): boolean {
        if (orgAddresses.some((a1) => areHexEqual(a1, definition.contractAddress))) {
            return true;
        }

        const contractOrg = contractOrgs.get(definition.contractAddress.toLowerCase()) ?? null;
        return permissions.some((p) => {
            const wallets = this.walletContextFor(reader, p, contractOrg);
            return wallets !== null && this.matchPermission(wallets, p, definition);
        });
    }

    private matchPermission(
        walletAddresses: Address[],
        permission: BarePermission,
        definition: EventDefinition
    ): boolean {
        const checks: Check[] = [
            { type: permission.topic0Constant ? 'equalTo' : 'none', value: permission.topic0Constant },
            { type: permission.topic1ConditionType ?? 'none', value: permission.topic1Constant },
            { type: permission.topic2ConditionType ?? 'none', value: permission.topic2Constant },
            { type: permission.topic3ConditionType ?? 'none', value: permission.topic3Constant }
        ];

        const topics: Array<Hex | null> = [
            definition.topic0 ?? null,
            definition.topic1 ?? null,
            definition.topic2 ?? null,
            definition.topic3 ?? null
        ];

        const zipped = checks.map((check, i): [Check, Hex | null] => [check, topics[i]!]);

        const walletAsTopics = walletAddresses.map((w) => pad(w));
        return zipped.every(([check, value]) => {
            switch (check.type) {
                case 'equalTo':
                    return check.value && value && areHexEqual(check.value, value);
                case 'userAddress':
                    return value !== null && walletAsTopics.some((w) => areHexEqual(w, value));
                case 'none':
                    return true;
                default:
                    return false;
            }
        });
    }

    async couldQueryMatch(userId: string, filter: GetLogsFilter, orgAddresses: Address[] = []): Promise<boolean> {
        if (orgAddresses.some((a) => this.isAddressCompatible(a, filter.address))) {
            return true;
        }

        const user = await this.repos.users.findById(userId);
        if (!user) return false;

        const roleIds = user.roles.map((r) => r.id);
        if (roleIds.length === 0) return false;

        const walletAddresses = user.wallets.map((w) => w.walletAddress);
        return this.couldQueryMatchForRoles(walletAddresses, roleIds, filter);
    }

    async couldQueryMatchForTenant(
        walletAddresses: Hex[],
        roleIds: string[],
        filter: GetLogsFilter,
        orgAddresses: Address[] = []
    ): Promise<boolean> {
        if (orgAddresses.some((a) => this.isAddressCompatible(a, filter.address))) {
            return true;
        }

        if (roleIds.length === 0) return false;
        return this.couldQueryMatchForRoles(walletAddresses, roleIds, filter);
    }

    private async couldQueryMatchForRoles(
        walletAddresses: Hex[],
        roleIds: string[],
        filter: GetLogsFilter
    ): Promise<boolean> {
        let permissions: BarePermission[];
        if (filter.address !== undefined) {
            const addresses = Array.isArray(filter.address) ? filter.address : [filter.address];
            permissions = await this.repos.contractEventsPermissions.searchForContractAndRoles(addresses, roleIds);
        } else {
            permissions = await this.repos.contractEventsPermissions.searchForRoles(roleIds);
        }

        if (permissions.length === 0) return false;

        return permissions.some((p) => this.couldPermissionMatchQuery(walletAddresses, p, filter));
    }

    couldPermissionMatchQuery(walletAddresses: Hex[], permission: BarePermission, filter: GetLogsFilter): boolean {
        // Check address compatibility
        if (!this.isAddressCompatible(permission.contractAddress, filter.address)) {
            return false;
        }

        // Check topic compatibility (topics 0-3)
        const queryTopics = filter.topics ?? [];
        const permissionTopics: Check[] = [
            { type: permission.topic0Constant ? 'equalTo' : 'none', value: permission.topic0Constant },
            { type: permission.topic1ConditionType ?? 'none', value: permission.topic1Constant },
            { type: permission.topic2ConditionType ?? 'none', value: permission.topic2Constant },
            { type: permission.topic3ConditionType ?? 'none', value: permission.topic3Constant }
        ];

        for (let i = 0; i < 4; i++) {
            const queryTopic = queryTopics[i];
            const permTopic = permissionTopics[i]!;

            if (!this.isTopicCompatible(walletAddresses, queryTopic, permTopic)) {
                return false;
            }
        }

        return true;
    }

    private isAddressCompatible(permissionAddress: Hex, filterAddress: Hex | Hex[] | undefined): boolean {
        if (filterAddress === undefined) return true;

        if (!Array.isArray(filterAddress)) {
            return areHexEqual(permissionAddress, filterAddress);
        }

        return filterAddress.some((a) => areHexEqual(permissionAddress, a));
    }

    private isTopicCompatible(
        walletAddresses: Hex[],
        queryTopic: Hex | Hex[] | null | undefined,
        permTopic: Check
    ): boolean {
        if (queryTopic === null || queryTopic === undefined) return true;

        if (permTopic.type === 'none') return true;

        const queryValues = Array.isArray(queryTopic) ? queryTopic : [queryTopic];

        if (permTopic.type === 'equalTo' && permTopic.value) {
            return queryValues.some((v) => areHexEqual(v, permTopic.value!));
        }

        if (permTopic.type === 'userAddress') {
            const paddedWallets = walletAddresses.map((w) => pad(w));
            return queryValues.some((v) => paddedWallets.some((w) => areHexEqual(v, w)));
        }

        return false;
    }
}

class PermissionsPerContractMap {
    /** Contract address -> Bare Permission */
    private map: Map<string, BarePermission[]>;

    constructor(permissions: BarePermission[]) {
        this.map = new Map();
        for (const permission of permissions) {
            const key = this.normalizeAddress(permission.contractAddress);
            const existing = this.map.get(key);
            if (existing) {
                existing.push(permission);
                continue;
            }
            this.map.set(key, [permission]);
        }
    }

    get(contractAddress: Address): BarePermission[] {
        return this.map.get(this.normalizeAddress(contractAddress)) ?? [];
    }

    private normalizeAddress(address: Address): string {
        return address.toLowerCase();
    }
}
