import { Abi as AbiSchema } from 'abitype/zod';
import { type Abi, type AbiFunction, type Address, toFunctionSelector } from 'viem';
import { z } from 'zod/v4';
import type { Repositories } from '../db';
import type { MethodAccessType } from '../db/schema';
import type { User } from '../repositories/users-repository';
import { EntityNotFound, InvalidEntity } from '../utils/error-types';

type Permission = {
    ruleType: string;
    permissionId: number;
    isContractPermission: boolean;
    functionSignature: string;
    accessType: MethodAccessType;
};

type FunctionData = {
    selector: `0x${string}`;
    signature: string;
    name: string;
    accessType: MethodAccessType;
};

export type FilteredAbiResult = {
    contractAddress: Address;
    name: string | null;
    abi: Record<string, unknown>[];
    functions: FunctionData[];
};

type Deps = {
    repos: Repositories;
    multiOrgEnabled?: boolean;
};

export class ContractAbiService {
    private readonly repos: Repositories;
    private readonly multiOrgEnabled: boolean;

    constructor({ repos, multiOrgEnabled = false }: Deps) {
        this.repos = repos;
        this.multiOrgEnabled = multiOrgEnabled;
    }

    async getFilteredAbi(user: User, contractAddress: Address): Promise<FilteredAbiResult> {
        const userRoleIds = user.roles.map((r) => r.id);

        const contract = await this.repos.contracts.findByAddress(contractAddress);

        // Mirrors AuthorizationService step 7 at contract granularity: while MULTI_ORG_ENABLED
        // is on, an org-owned contract reads as not-found to callers outside that org (zone
        // users included), so cross-org existence never leaks. Zone-level contracts
        // (organizationId null) stay visible to everyone. Coarser than the RPC check on
        // purpose: a permission a zone operator opened zone-wide (organizationOnly=false)
        // stays callable cross-org via RPC but is not disclosed here.
        if (this.multiOrgEnabled && contract.organizationId && contract.organizationId !== user.organizationId) {
            throw new EntityNotFound('Contract', { contractAddress });
        }
        const contractAbi = this.parseAbi(contract.abi);

        const fullAbi =
            contract.templateId !== null
                ? await this.mergeWithTemplateAbi(contractAbi, contract.templateId)
                : contractAbi;

        const permissionMap = await this.buildPermissionMap(contractAddress, contract.templateId);

        const roleAccessMap = await this.batchFetchRoleAccess(permissionMap, userRoleIds);

        const accessibleFunctionMap = this.determineAccessibleFunctions(permissionMap, roleAccessMap, userRoleIds);

        const accessibleSelectors = new Set(accessibleFunctionMap.keys());
        const filteredAbi = this.filterAbi(fullAbi, accessibleSelectors);

        return {
            contractAddress: contract.contractAddress as Address,
            name: contract.name,
            abi: filteredAbi as unknown as Record<string, unknown>[],
            functions: [...accessibleFunctionMap.values()]
        };
    }

    private parseAbi(abiString: string): Abi {
        try {
            const parsed = JSON.parse(abiString);
            return AbiSchema.parse(parsed) as Abi;
        } catch (e) {
            if (e instanceof SyntaxError) {
                throw new InvalidEntity('Contract ABI is malformed (invalid JSON)');
            }
            if (e instanceof z.ZodError) {
                throw new InvalidEntity('Contract ABI is malformed (invalid structure)');
            }
            throw e;
        }
    }

    private async mergeWithTemplateAbi(contractAbi: Abi, templateId: number): Promise<Abi> {
        const template = await this.repos.templates.getById(templateId);
        const templateAbi = this.parseAbi(template.abi);

        const contractFunctionSelectors = new Set<string>();
        const contractErrorNames = new Set<string>();
        for (const item of contractAbi) {
            if (item.type === 'function') {
                contractFunctionSelectors.add(toFunctionSelector(item as AbiFunction).toLowerCase());
            } else if (item.type === 'error') {
                contractErrorNames.add(item.name);
            }
        }

        const templateItems = templateAbi.filter((item) => {
            if (item.type === 'function') {
                return !contractFunctionSelectors.has(toFunctionSelector(item as AbiFunction).toLowerCase());
            }
            if (item.type === 'error') {
                return !contractErrorNames.has(item.name);
            }
            // constructor, fallback, receive — skip if contract already has one
            return !contractAbi.some((c) => c.type === item.type);
        });

        return [...contractAbi, ...templateItems];
    }

    private async buildPermissionMap(
        contractAddress: Address,
        templateId: number | null
    ): Promise<Map<string, Permission>> {
        const contractPermissions =
            await this.repos.contractFunctionPermissions.findAllByContractAddress(contractAddress);

        const templatePermissions = templateId
            ? await this.repos.templatePermissions.findAllByTemplateId(templateId)
            : [];

        const permissionMap = new Map<string, Permission>();

        for (const perm of templatePermissions) {
            permissionMap.set(perm.methodSelector.toLowerCase(), {
                ruleType: perm.ruleType,
                permissionId: perm.id,
                isContractPermission: false,
                functionSignature: perm.functionSignature,
                accessType: perm.accessType as MethodAccessType
            });
        }

        for (const perm of contractPermissions) {
            permissionMap.set(perm.methodSelector.toLowerCase(), {
                ruleType: perm.ruleType,
                permissionId: perm.id,
                isContractPermission: true,
                functionSignature: perm.functionSignature,
                accessType: perm.accessType as MethodAccessType
            });
        }

        return permissionMap;
    }

    private async batchFetchRoleAccess(
        permissionMap: Map<string, Permission>,
        userRoleIds: string[]
    ): Promise<Map<number, boolean>> {
        if (userRoleIds.length === 0) {
            return new Map();
        }

        const contractPermIds: number[] = [];
        const templatePermIds: number[] = [];

        for (const perm of permissionMap.values()) {
            if (
                perm.ruleType === 'checkRole' ||
                perm.ruleType === 'checkRoleOrRestrictArgument' ||
                perm.ruleType === 'checkRoleAndRestrictArgument'
            ) {
                if (perm.isContractPermission) {
                    contractPermIds.push(perm.permissionId);
                } else {
                    templatePermIds.push(perm.permissionId);
                }
            }
        }

        const [contractAccessSet, templateAccessSet] = await Promise.all([
            this.repos.contractFunctionPermissions.findPermissionIdsWithUserRoles(contractPermIds, userRoleIds),
            this.repos.templatePermissions.findPermissionIdsWithUserRoles(templatePermIds, userRoleIds)
        ]);

        const hasAccess = new Map<number, boolean>();
        for (const permissionId of contractAccessSet) {
            hasAccess.set(permissionId, true);
        }
        for (const permissionId of templateAccessSet) {
            hasAccess.set(permissionId, true);
        }
        return hasAccess;
    }

    private determineAccessibleFunctions(
        permissionMap: Map<string, Permission>,
        roleAccessMap: Map<number, boolean>,
        userRoleIds: string[]
    ): Map<string, FunctionData> {
        const result = new Map<string, FunctionData>();

        for (const [selector, permission] of permissionMap) {
            let isAccessible = false;

            if (permission.ruleType === 'public') {
                isAccessible = true;
            } else if (
                permission.ruleType === 'checkRole' ||
                permission.ruleType === 'checkRoleOrRestrictArgument' ||
                permission.ruleType === 'checkRoleAndRestrictArgument'
            ) {
                if (userRoleIds.length > 0) {
                    isAccessible = roleAccessMap.get(permission.permissionId) ?? false;
                }
            } else if (permission.ruleType === 'restrictArgument') {
                isAccessible = true;
            }

            if (isAccessible) {
                const funcName = permission.functionSignature.replace(/^function\s+/, '').split('(')[0] || '';
                result.set(selector, {
                    selector: selector as `0x${string}`,
                    signature: permission.functionSignature,
                    name: funcName,
                    accessType: permission.accessType
                });
            }
        }

        return result;
    }

    private filterAbi(fullAbi: Abi, accessibleSelectors: Set<string>): Abi {
        return fullAbi.filter((item) => {
            // Filter out events
            if (item.type === 'event') {
                return false;
            }
            // Filter functions based on user's permissions
            if (item.type === 'function') {
                const func = item as AbiFunction;
                const selector = toFunctionSelector(func);
                return accessibleSelectors.has(selector.toLowerCase());
            }
            // Keep errors
            return true;
        });
    }
}
