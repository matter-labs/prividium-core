import { and, asc, count, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { AbiFunction, AbiParameter, Address, Hex } from 'viem';
import { z } from 'zod/v4';
import type { TxType } from '../db';
import {
    argumentRestrictionsTable,
    contractFunctionPermissionRolesTable,
    contractFunctionPermissionsTable,
    contractsTable,
    type MethodRule,
    methodAccessSchema,
    methodRuleSchema,
    rolesTable
} from '../db/schema';
import { abiFromString, calculateFunctionSelector, findAbiFnBySelector } from '../utils/abi';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError, UnexpectedDbError } from '../utils/error-types';
import { hexSchema } from '../utils/schemas/hex-schema';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';

export const basicContractPermissionSchema = z.object({
    id: z.number().int(),
    contractAddress: hexSchema,
    methodSelector: hexSchema,
    accessType: methodAccessSchema,
    functionSignature: z.string(),
    ruleType: methodRuleSchema,
    isUmbrella: z.boolean().default(false),
    organizationOnly: z.boolean().optional(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date()
});

const insertPermissionSchema = z.object({
    ...basicContractPermissionSchema.omit({ id: true, createdAt: true, updatedAt: true }).shape,
    methodSelector: hexSchema.optional(),
    isUmbrella: z.boolean().optional()
});

type Insert = z.infer<typeof insertPermissionSchema>;

const roleDataSchema = z.object({
    id: z.string().min(1),
    // Populated on reads for display; ignored on writes.
    roleName: z.string().optional()
});
type Role = z.infer<typeof roleDataSchema>;

const argumentRestrictionSchema = z.object({
    argumentIndex: z.number().int()
});
type ArgumentRestriction = z.infer<typeof argumentRestrictionSchema>;

const relationsSchema = z.object({
    roles: z.array(roleDataSchema).optional(),
    argumentRestrictions: z.array(argumentRestrictionSchema).optional()
});

export const newContractPermissionSchema = z.object({
    ...insertPermissionSchema.shape,
    ...relationsSchema.shape
});

export type NewContractPermission = z.infer<typeof newContractPermissionSchema>;
export const fullContractPermissionSchema = z.object({
    ...basicContractPermissionSchema.shape,
    ...relationsSchema.shape
});
export type FullContractPermission = z.infer<typeof fullContractPermissionSchema>;
export const updateContractPermissionSchema = z.object({
    ...basicContractPermissionSchema.omit({ createdAt: true, updatedAt: true }).shape,
    ...relationsSchema.shape,
    id: z.number().int().optional(),
    isUmbrella: z.boolean().optional()
});

export type UpdateContractPermission = z.infer<typeof updateContractPermissionSchema>;

const isEmpty = <T>(list: T[] | undefined) => list === undefined || list.length === 0;

type AbiResolutionResult = {
    inputs: readonly AbiParameter[];
    source: 'contract' | 'template';
    templateAbiFn?: AbiFunction; // Only present when source is 'template'
};

export class ContractFunctionPermissionsRepository extends BaseRepository {
    private validateConditionByRuleType(ruleType: MethodRule) {
        switch (ruleType) {
            case 'public':
                return {
                    check: (permission: NewContractPermission) =>
                        isEmpty(permission.argumentRestrictions) && isEmpty(permission.roles),
                    msg: '"public" rules should not define "roles" or "argumentRestrictions"'
                };
            case 'checkRole':
                return {
                    check: (permission: NewContractPermission) =>
                        isEmpty(permission.argumentRestrictions) && !isEmpty(permission.roles),
                    msg: '"checkRole" should define roles but no argumentRestrictions'
                };
            case 'restrictArgument':
                return {
                    check: (permission: NewContractPermission) =>
                        !isEmpty(permission.argumentRestrictions) && isEmpty(permission.roles),
                    msg: '"restrictArgument" should specify argumentRestrictions but not roles'
                };
            // Both perform the same check because both require both to be defined to work properly.
            case 'checkRoleAndRestrictArgument':
            case 'checkRoleOrRestrictArgument':
                return {
                    check: (permission: NewContractPermission) =>
                        !isEmpty(permission.argumentRestrictions) && !isEmpty(permission.roles),
                    msg: `"${ruleType}" should define roles and argument restrictions`
                };
            default:
                throw new Error('Unknown rule type');
        }
    }

    private validate(permission: Insert): Hex {
        const { check, msg } = this.validateConditionByRuleType(permission.ruleType);
        if (!check(permission)) {
            throw new InvalidInputError(msg);
        }
        const recalculated = calculateFunctionSelector(permission.functionSignature);
        if (
            permission.methodSelector !== undefined &&
            permission.methodSelector.toLowerCase() !== recalculated.toLowerCase()
        ) {
            throw new InvalidInputError(`Mismatch between "selector" and "functionSignature".`);
        }
        return recalculated;
    }

    private async assertsPermissionDoesNotExist(tx: TxType, permission: Insert, selector: Hex): Promise<void> {
        const existing = await tx.query.contractFunctionPermissionsTable.findFirst({
            columns: { id: true },
            where: and(
                eq(contractFunctionPermissionsTable.contractAddress, permission.contractAddress),
                eq(contractFunctionPermissionsTable.methodSelector, selector),
                eq(contractFunctionPermissionsTable.accessType, permission.accessType)
            )
        });

        if (existing) {
            throw new EntityAlreadyExistsError(
                'Contract permissions with this selector, contractAddress and accessType already exists'
            );
        }
    }

    private async checkRolesExist(tx: TxType, roles: Role[]): Promise<void> {
        // Search all roles in parallel
        const promises = roles.map(async (role) =>
            tx.query.rolesTable.findFirst({
                columns: { id: true },
                where: eq(rolesTable.id, role.id)
            })
        );

        // Promises resolve to a role or undefined.
        const existingRoles = await Promise.all(promises);

        // If there is at least 1 non found role, a descriptive error is thrown.
        const missingIndex = existingRoles.indexOf(undefined);
        if (missingIndex !== -1) {
            // We can safely search for the index, because it's an index of a collection with the same length
            const missing = roles[missingIndex]!;
            throw new InvalidInputError(`Role with id="${missing.id}" not found`);
        }
    }

    private async insertRolesRestrictions(tx: TxType, permissionId: number, roles?: Role[]): Promise<Role[]> {
        if (roles === undefined || roles.length === 0) return [];

        await this.checkRolesExist(tx, roles);
        const inserted = await tx
            .insert(contractFunctionPermissionRolesTable)
            .values(
                roles.map((role) => ({
                    permissionId: permissionId,
                    roleId: role.id
                }))
            )
            .returning();
        // Attach role names so create/update responses match the read shape.
        const roleRows = await tx.query.rolesTable.findMany({
            columns: { id: true, roleName: true },
            where: inArray(
                rolesTable.id,
                inserted.map((row) => row.roleId)
            )
        });
        const nameById = new Map(roleRows.map((r) => [r.id, r.roleName]));
        return inserted.map((row) => ({ id: row.roleId, roleName: nameById.get(row.roleId) }));
    }

    private async insertArgumentRestrictions(
        tx: TxType,
        permissionId: number,
        restrictions?: ArgumentRestriction[]
    ): Promise<ArgumentRestriction[]> {
        if (restrictions === undefined || restrictions.length === 0) return [];

        return tx
            .insert(argumentRestrictionsTable)
            .values(
                restrictions.map((a) => ({
                    permissionId: permissionId,
                    argumentIndex: a.argumentIndex
                }))
            )
            .returning();
    }

    /**
     * Resolves ABI function inputs from contract first, falling back to template.
     * Pure function - no side effects.
     */
    private async resolveAbiInputs(
        tx: TxType,
        contractAddress: Hex,
        contractAbiStr: string,
        templateId: number | null,
        methodSelector: Hex,
        functionSignature: string
    ): Promise<AbiResolutionResult> {
        const contractAbi = abiFromString(contractAbiStr);

        // Handle receive function special case
        if (methodSelector === '0x' && contractAbi.some((elem) => elem.type === 'receive')) {
            return { inputs: [], source: 'contract' };
        }

        // Try contract ABI first
        const contractAbiFn = findAbiFnBySelector(contractAbi, methodSelector);
        if (contractAbiFn) {
            return { inputs: contractAbiFn.inputs, source: 'contract' };
        }

        // No template = function not found
        if (!templateId) {
            throw new InvalidInputError(
                `functionSignature="${functionSignature}" not included in abi for contract address=${contractAddress}`
            );
        }

        // Fetch template
        const templateRow = await tx.query.contractTemplatesTable.findFirst({
            where: (f, { eq }) => eq(f.id, templateId),
            columns: { abi: true }
        });

        if (!templateRow) {
            throw new EntityNotFound('Template', { id: templateId });
        }

        // Try template ABI
        const templateAbi = abiFromString(templateRow.abi);
        const templateAbiFn = findAbiFnBySelector(templateAbi, methodSelector);

        if (!templateAbiFn) {
            throw new InvalidInputError(
                `functionSignature="${functionSignature}" not found in contract or template abi`
            );
        }

        return {
            inputs: templateAbiFn.inputs,
            source: 'template',
            templateAbiFn
        };
    }

    /**
     * Updates contract ABI by appending a function from the template.
     */
    private async appendFunctionToContractAbi(
        tx: TxType,
        contractAddress: Hex,
        contractAbiStr: string,
        abiFn: AbiFunction
    ): Promise<void> {
        const contractAbi = abiFromString(contractAbiStr);
        await tx
            .update(contractsTable)
            .set({ abi: JSON.stringify([...contractAbi, abiFn]) })
            .where(eq(contractsTable.contractAddress, contractAddress));
    }

    async create(permission: NewContractPermission): Promise<FullContractPermission> {
        const methodSelector = this.validate(permission);
        return await this.transaction(async (tx) => {
            const contractRow = await tx.query.contractsTable.findFirst({
                where: (f, { eq }) => eq(f.contractAddress, permission.contractAddress),
                columns: { abi: true, templateId: true, contractAddress: true }
            });

            if (!contractRow) {
                throw new EntityNotFound('Contract', { contractAddress: permission.contractAddress });
            }

            const resolution = await this.resolveAbiInputs(
                tx,
                contractRow.contractAddress,
                contractRow.abi,
                contractRow.templateId,
                methodSelector,
                permission.functionSignature
            );

            // If function came from template, add it to the contract ABI
            if (resolution.source === 'template' && resolution.templateAbiFn) {
                await this.appendFunctionToContractAbi(
                    tx,
                    contractRow.contractAddress,
                    contractRow.abi,
                    resolution.templateAbiFn
                );
            }

            await this.assertsPermissionDoesNotExist(tx, permission, methodSelector);
            this.assertArgRestrictionsAreValid(
                permission.argumentRestrictions,
                resolution.inputs,
                permission.functionSignature
            );

            const [inserted] = await tx
                .insert(contractFunctionPermissionsTable)
                .values({ ...permission, methodSelector })
                .returning();

            if (inserted === undefined) {
                throw new UnexpectedDbError('Error inserting contract permission');
            }

            const [roles, argumentRestrictions] = await Promise.all([
                this.insertRolesRestrictions(tx, inserted.id, permission.roles),
                this.insertArgumentRestrictions(tx, inserted.id, permission.argumentRestrictions)
            ]);

            // Return permission with roles
            const createdPermission = {
                ...inserted,
                roles,
                argumentRestrictions
            };

            return createdPermission;
        });
    }

    async getPermissionById(id: number): Promise<FullContractPermission> {
        const permission = await this.db.query.contractFunctionPermissionsTable.findFirst({
            where: eq(contractFunctionPermissionsTable.id, id),
            with: {
                roles: { with: { role: { columns: { id: true, roleName: true } } } },
                argumentRestrictions: true
            }
        });
        if (!permission) {
            throw new EntityNotFound('Contract permission', { id });
        }

        return {
            ...permission,
            roles: permission.roles.map((r) => ({ id: r.role.id, roleName: r.role.roleName }))
        };
    }

    async update(id: number, permission: UpdateContractPermission): Promise<FullContractPermission> {
        this.validate(permission);
        const { id: permissionId, roles, argumentRestrictions, ...fields } = permission;
        if (permissionId !== undefined && permissionId !== id) {
            throw new InvalidInputError('id mismatch');
        }

        return await this.transaction(async (tx) => {
            const [updated] = await tx
                .update(contractFunctionPermissionsTable)
                .set(fields)
                .where(
                    and(
                        eq(contractFunctionPermissionsTable.id, id),
                        eq(contractFunctionPermissionsTable.methodSelector, fields.methodSelector),
                        eq(contractFunctionPermissionsTable.contractAddress, fields.contractAddress)
                    )
                )
                .returning();

            if (!updated) {
                throw new EntityNotFound('Permission', { id });
            }

            await Promise.all([
                tx
                    .delete(contractFunctionPermissionRolesTable)
                    .where(eq(contractFunctionPermissionRolesTable.permissionId, id)),
                tx.delete(argumentRestrictionsTable).where(eq(argumentRestrictionsTable.permissionId, id))
            ]);

            const [updatedRoles, updatedArgumentRestrictions] = await Promise.all([
                this.insertRolesRestrictions(tx, id, roles),
                this.insertArgumentRestrictions(tx, id, argumentRestrictions)
            ]);

            const updatedPermission = {
                ...updated,
                roles: updatedRoles,
                argumentRestrictions: updatedArgumentRestrictions
            };

            return updatedPermission;
        });
    }

    async delete(id: number): Promise<void> {
        await this.transaction(async (tx) => {
            // Delete relations
            await tx
                .delete(contractFunctionPermissionRolesTable)
                .where(eq(contractFunctionPermissionRolesTable.permissionId, id));
            await tx.delete(argumentRestrictionsTable).where(eq(argumentRestrictionsTable.permissionId, id));

            // Delete entity
            const [deleted] = await tx
                .delete(contractFunctionPermissionsTable)
                .where(eq(contractFunctionPermissionsTable.id, id))
                .returning({ id: contractFunctionPermissionsTable.id });
            if (!deleted) {
                throw new EntityNotFound('Permission', { id });
            }
        });
    }

    async findPaginated(
        filterOptions: {
            contractAddress?: Address;
            methodSelector?: Hex;
            roleId?: string;
            organizationId?: string;
        },
        { limit, offset }: PaginationParams
    ): Promise<PaginatedResult<FullContractPermission>> {
        const { contractAddress, methodSelector, roleId, organizationId } = filterOptions;

        const filters = [];
        if (contractAddress !== undefined) {
            filters.push(eq(contractFunctionPermissionsTable.contractAddress, contractAddress));
        }
        if (methodSelector !== undefined) {
            filters.push(eq(contractFunctionPermissionsTable.methodSelector, methodSelector));
        }

        // Because the roles is not a row in the same table, in order to keep the same response schema we need
        // To manually fetch and build the response (instead of using query api).
        // The strategy to make pagination work is make a subquery in chaarge of getting the right rows,
        // and an outer query in charge of populating all the joins.
        const identityQuery = this.db
            .select({ ...getTableColumns(contractFunctionPermissionsTable) })
            .from(contractFunctionPermissionsTable)
            .$dynamic();

        // If the role is defined an inner join is made (in this case only permissions with roles has to be
        // returned). Also, the filter for role is added.
        if (roleId !== undefined) {
            identityQuery.innerJoin(
                contractFunctionPermissionRolesTable,
                eq(contractFunctionPermissionsTable.id, contractFunctionPermissionRolesTable.permissionId)
            );
            // This works because the pair [roleId, permissionId] has a unique constraint.
            filters.push(eq(contractFunctionPermissionRolesTable.roleId, roleId));
        }

        if (organizationId !== undefined) {
            identityQuery.innerJoin(
                contractsTable,
                eq(contractsTable.contractAddress, contractFunctionPermissionsTable.contractAddress)
            );
            filters.push(eq(contractsTable.organizationId, organizationId));
        }

        identityQuery.where(and(...filters));

        // First get total count for pagination. This is done first to avoid changing the state
        // of the query builder with the limits and offset values.
        const rowCount = await this.db
            .select({ count: count() })
            .from(identityQuery.as('sq'))
            .then((res) => res[0]?.count ?? 0);

        // Subquery with pagination.
        const subquery = identityQuery
            .limit(limit)
            .offset(offset)
            .orderBy(
                asc(contractFunctionPermissionsTable.contractAddress),
                desc(contractFunctionPermissionsTable.createdAt)
            )
            .as('contractPermission');

        // Outer query with joins
        const rawItems = await this.db
            .select()
            .from(subquery)
            .leftJoin(
                contractFunctionPermissionRolesTable,
                eq(subquery.id, contractFunctionPermissionRolesTable.permissionId)
            )
            .leftJoin(rolesTable, eq(contractFunctionPermissionRolesTable.roleId, rolesTable.id))
            .leftJoin(argumentRestrictionsTable, eq(subquery.id, argumentRestrictionsTable.permissionId));

        // Build response schema from raw data. Accumulate items in a map to ensure insertion order.
        const itemMap = new Map<number, FullContractPermission>();
        // Track which roles and arguments have been added to prevent duplicates from cartesian product
        const addedRoles = new Map<number, Set<string>>();
        const addedArguments = new Map<number, Set<number>>();

        for (const rawItem of rawItems) {
            const permissionId = rawItem.contractPermission.id;
            const existing = itemMap.get(permissionId);
            const permissionRoleId = rawItem?.contract_function_permission_roles?.roleId;
            const roleName = rawItem?.roles?.roleName ?? undefined;
            const argumentIndex = rawItem?.function_argument_restrictions?.argumentIndex;

            if (existing) {
                // Only add role if not already added (prevents duplicates from cartesian product)
                if (permissionRoleId !== undefined && !addedRoles.get(permissionId)?.has(permissionRoleId)) {
                    existing?.roles?.push({ id: permissionRoleId, roleName });
                    addedRoles.get(permissionId)?.add(permissionRoleId);
                }
                // Only add argument restriction if not already added
                if (argumentIndex !== undefined && !addedArguments.get(permissionId)?.has(argumentIndex)) {
                    existing?.argumentRestrictions?.push({ argumentIndex });
                    addedArguments.get(permissionId)?.add(argumentIndex);
                }
            } else {
                itemMap.set(permissionId, {
                    ...rawItem.contractPermission,
                    roles: permissionRoleId ? [{ id: permissionRoleId, roleName }] : [],
                    argumentRestrictions: argumentIndex !== undefined ? [{ argumentIndex }] : []
                });
                // Initialize tracking sets
                addedRoles.set(permissionId, new Set(permissionRoleId ? [permissionRoleId] : []));
                addedArguments.set(permissionId, new Set(argumentIndex !== undefined ? [argumentIndex] : []));
            }
        }

        return {
            items: [...itemMap.values()],
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(rowCount / limit),
                totalItems: rowCount,
                limit,
                offset
            }
        };
    }

    private assertArgRestrictionsAreValid(
        argumentRestrictions: ArgumentRestriction[] | undefined,
        abiParameters: readonly AbiParameter[],
        signature: string
    ) {
        if (argumentRestrictions === undefined) return;
        const invalidArg = argumentRestrictions.find(
            (restriction) => restriction.argumentIndex >= abiParameters.length
        );
        if (invalidArg !== undefined) {
            throw new InvalidInputError(
                `functionSignature="${signature}" cannot be restricted in argument number ${invalidArg.argumentIndex}. It takes only ${abiParameters.length} parameters`
            );
        }
    }

    async findAllByContractAddress(
        contractAddress: Address
    ): Promise<(typeof contractFunctionPermissionsTable.$inferSelect)[]> {
        return this.db
            .select()
            .from(contractFunctionPermissionsTable)
            .where(eq(contractFunctionPermissionsTable.contractAddress, contractAddress));
    }

    async clearUmbrella(contractAddress: Address): Promise<void> {
        await this.db
            .update(contractFunctionPermissionsTable)
            .set({ isUmbrella: false })
            .where(eq(contractFunctionPermissionsTable.contractAddress, contractAddress));
    }

    async findPermissionIdsWithUserRoles(permissionIds: number[], roleIds: string[]): Promise<Set<number>> {
        if (permissionIds.length === 0 || roleIds.length === 0) {
            return new Set();
        }

        const matches = await this.db
            .select({ permissionId: contractFunctionPermissionRolesTable.permissionId })
            .from(contractFunctionPermissionRolesTable)
            .where(
                and(
                    inArray(contractFunctionPermissionRolesTable.permissionId, permissionIds),
                    inArray(contractFunctionPermissionRolesTable.roleId, roleIds)
                )
            );

        const result = new Set<number>();
        for (const { permissionId } of matches) {
            if (permissionId !== null) {
                result.add(permissionId);
            }
        }
        return result;
    }
}
