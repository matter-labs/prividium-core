import { Abi as AbiSchema } from 'abitype/zod';
import { and, asc, count, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { Abi, AbiParameter, Hex } from 'viem';
import { z } from 'zod/v4';
import type { TxType } from '../db';
import {
    contractTemplateArgumentRestrictionsTable,
    contractTemplatePermissionRolesTable,
    contractTemplatePermissionsTable,
    type MethodRule,
    methodAccessSchema,
    methodRuleSchema,
    rolesTable
} from '../db/schema';
import { calculateFunctionSelector, findAbiFnBySelector } from '../utils/abi';
import {
    EntityAlreadyExistsError,
    EntityNotFound,
    InvalidEntity,
    InvalidInputError,
    UnexpectedDbError
} from '../utils/error-types';
import { hexSchema } from '../utils/schemas/hex-schema';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';

export const basicTemplatePermissionSchema = z.object({
    id: z.number().int(),
    templateId: z.number().int(),
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
    ...basicTemplatePermissionSchema.omit({ id: true, createdAt: true, updatedAt: true }).shape,
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

export const newTemplatePermissionSchema = z.object({
    ...insertPermissionSchema.shape,
    ...relationsSchema.shape
});

export type NewTemplatePermission = z.infer<typeof newTemplatePermissionSchema>;

export const fullTemplatePermissionSchema = z.object({
    ...basicTemplatePermissionSchema.shape,
    ...relationsSchema.shape
});
export type FullTemplatePermission = z.infer<typeof fullTemplatePermissionSchema>;

export const updateTemplatePermissionSchema = z
    .object({
        ...basicTemplatePermissionSchema.omit({ createdAt: true, updatedAt: true }).shape,
        ...relationsSchema.shape,
        id: z.number().int().optional(),
        isUmbrella: z.boolean().optional()
    })
    .required({ isUmbrella: true, organizationOnly: true, roles: true, argumentRestrictions: true });

export type UpdateTemplatePermission = z.infer<typeof updateTemplatePermissionSchema>;

const isEmpty = <T>(list: T[] | undefined) => list === undefined || list.length === 0;

export class TemplatePermissionsRepository extends BaseRepository {
    private validateConditionByRuleType(ruleType: MethodRule) {
        switch (ruleType) {
            case 'public':
                return {
                    check: (permission: NewTemplatePermission) =>
                        isEmpty(permission.argumentRestrictions) && isEmpty(permission.roles),
                    msg: '"public" rules should not define "roles" or "argumentRestrictions"'
                };
            case 'checkRole':
                return {
                    check: (permission: NewTemplatePermission) =>
                        isEmpty(permission.argumentRestrictions) && !isEmpty(permission.roles),
                    msg: '"checkRole" should define roles but no argumentRestrictions'
                };
            case 'restrictArgument':
                return {
                    check: (permission: NewTemplatePermission) =>
                        !isEmpty(permission.argumentRestrictions) && isEmpty(permission.roles),
                    msg: '"restrictArgument" should specify argumentRestrictions but not roles'
                };
            case 'checkRoleAndRestrictArgument':
            case 'checkRoleOrRestrictArgument':
                return {
                    check: (permission: NewTemplatePermission) =>
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
        const existing = await tx.query.contractTemplatePermissionsTable.findFirst({
            columns: { id: true },
            where: and(
                eq(contractTemplatePermissionsTable.templateId, permission.templateId),
                eq(contractTemplatePermissionsTable.methodSelector, selector)
            )
        });

        if (existing) {
            throw new EntityAlreadyExistsError('Template permission with this selector and templateId already exists');
        }
    }

    private async checkRolesExist(tx: TxType, roles: Role[]): Promise<void> {
        const promises = roles.map(async (role) =>
            tx.query.rolesTable.findFirst({
                columns: { id: true },
                where: eq(rolesTable.id, role.id)
            })
        );

        const existingRoles = await Promise.all(promises);
        const missingIndex = existingRoles.indexOf(undefined);
        if (missingIndex !== -1) {
            const missing = roles[missingIndex]!;
            throw new InvalidInputError(`Role with id="${missing.id}" not found`);
        }
    }

    private async insertRolesRestrictions(tx: TxType, permissionId: number, roles?: Role[]): Promise<Role[]> {
        if (roles === undefined || roles.length === 0) return [];

        await this.checkRolesExist(tx, roles);
        const inserted = await tx
            .insert(contractTemplatePermissionRolesTable)
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
            .insert(contractTemplateArgumentRestrictionsTable)
            .values(
                restrictions.map((a) => ({
                    permissionId: permissionId,
                    argumentIndex: a.argumentIndex
                }))
            )
            .returning();
    }

    private parseAbi(abiStr: string): Abi {
        let json: unknown;
        try {
            json = JSON.parse(abiStr);
        } catch (e) {
            if (e instanceof SyntaxError) {
                throw new InvalidEntity('abi should be a valid JSON.');
            }
            throw e;
        }

        const parsed = AbiSchema.safeParse(json);
        if (!parsed.success) {
            throw new InvalidEntity('invalid abi structure');
        }
        return parsed.data as Abi;
    }

    private extractAbiInputs(
        abiStr: string,
        methodSelector: Hex,
        permission: NewTemplatePermission
    ): readonly AbiParameter[] {
        const abi = this.parseAbi(abiStr);
        if (methodSelector === '0x' && abi.some((elem) => elem.type === 'receive')) {
            return [];
        }

        const abiFn = findAbiFnBySelector(abi, methodSelector);

        if (abiFn === undefined) {
            throw new InvalidInputError(
                `functionSignature="${permission.functionSignature}" not included in abi for template id=${permission.templateId}`
            );
        }

        return abiFn.inputs;
    }

    async create(permission: NewTemplatePermission): Promise<FullTemplatePermission> {
        const methodSelector = this.validate(permission);
        return await this.transaction(async (tx) => {
            const templateRow = await tx.query.contractTemplatesTable.findFirst({
                where: (f, { eq }) => eq(f.id, permission.templateId),
                columns: { abi: true }
            });

            if (!templateRow) {
                throw new EntityNotFound('Template', { id: permission.templateId });
            }

            const abiArgs = this.extractAbiInputs(templateRow.abi, methodSelector, permission);
            await this.assertsPermissionDoesNotExist(tx, permission, methodSelector);
            this.assertArgRestrictionsAreValid(permission.argumentRestrictions, abiArgs, permission.functionSignature);

            const [inserted] = await tx
                .insert(contractTemplatePermissionsTable)
                .values({ ...permission, methodSelector })
                .returning();

            if (inserted === undefined) {
                throw new UnexpectedDbError('Error inserting template permission');
            }

            const [roles, argumentRestrictions] = await Promise.all([
                this.insertRolesRestrictions(tx, inserted.id, permission.roles),
                this.insertArgumentRestrictions(tx, inserted.id, permission.argumentRestrictions)
            ]);

            return {
                ...inserted,
                roles,
                argumentRestrictions
            };
        });
    }

    async getPermissionById(id: number): Promise<FullTemplatePermission> {
        const permission = await this.db.query.contractTemplatePermissionsTable.findFirst({
            where: eq(contractTemplatePermissionsTable.id, id),
            with: {
                roles: { with: { role: { columns: { id: true, roleName: true } } } },
                argumentRestrictions: true
            }
        });
        if (!permission) {
            throw new EntityNotFound('TemplatePermission', { id });
        }

        return {
            ...permission,
            roles: permission.roles.map((r) => ({ id: r.role.id, roleName: r.role.roleName }))
        };
    }

    async update(id: number, permission: UpdateTemplatePermission): Promise<FullTemplatePermission> {
        this.validate(permission);
        const { id: permissionId, roles, argumentRestrictions, ...fields } = permission;
        if (permissionId !== undefined && permissionId !== id) {
            throw new InvalidInputError('id mismatch');
        }

        return await this.transaction(async (tx) => {
            // Fetch template ABI for validation
            const templateRow = await tx.query.contractTemplatesTable.findFirst({
                where: (f, { eq }) => eq(f.id, fields.templateId),
                columns: { abi: true }
            });

            if (!templateRow) {
                throw new EntityNotFound('Template', { id: fields.templateId });
            }

            // Validate argument restrictions against ABI
            const abiArgs = this.extractAbiInputs(templateRow.abi, fields.methodSelector, permission);
            this.assertArgRestrictionsAreValid(argumentRestrictions, abiArgs, fields.functionSignature);

            const [updated] = await tx
                .update(contractTemplatePermissionsTable)
                .set(fields)
                .where(
                    and(
                        eq(contractTemplatePermissionsTable.id, id),
                        eq(contractTemplatePermissionsTable.methodSelector, fields.methodSelector),
                        eq(contractTemplatePermissionsTable.templateId, fields.templateId)
                    )
                )
                .returning();

            if (!updated) {
                throw new EntityNotFound('TemplatePermission', {
                    id,
                    methodSelector: fields.methodSelector,
                    templateId: fields.templateId
                });
            }

            await Promise.all([
                tx
                    .delete(contractTemplatePermissionRolesTable)
                    .where(eq(contractTemplatePermissionRolesTable.permissionId, id)),
                tx
                    .delete(contractTemplateArgumentRestrictionsTable)
                    .where(eq(contractTemplateArgumentRestrictionsTable.permissionId, id))
            ]);

            const [updatedRoles, updatedArgumentRestrictions] = await Promise.all([
                this.insertRolesRestrictions(tx, id, roles),
                this.insertArgumentRestrictions(tx, id, argumentRestrictions)
            ]);

            return {
                ...updated,
                roles: updatedRoles,
                argumentRestrictions: updatedArgumentRestrictions
            };
        });
    }

    async delete(id: number): Promise<void> {
        await this.transaction(async (tx) => {
            await tx
                .delete(contractTemplatePermissionRolesTable)
                .where(eq(contractTemplatePermissionRolesTable.permissionId, id));
            await tx
                .delete(contractTemplateArgumentRestrictionsTable)
                .where(eq(contractTemplateArgumentRestrictionsTable.permissionId, id));

            const [deleted] = await tx
                .delete(contractTemplatePermissionsTable)
                .where(eq(contractTemplatePermissionsTable.id, id))
                .returning({ id: contractTemplatePermissionsTable.id });
            if (!deleted) {
                throw new EntityNotFound('TemplatePermission', { id });
            }
        });
    }

    async findPaginated(
        filterOptions: { templateId?: number; methodSelector?: Hex; roleId?: string },
        { limit, offset }: PaginationParams
    ): Promise<PaginatedResult<FullTemplatePermission>> {
        const { templateId, methodSelector, roleId } = filterOptions;

        const filters = [];
        if (templateId !== undefined) {
            filters.push(eq(contractTemplatePermissionsTable.templateId, templateId));
        }
        if (methodSelector !== undefined) {
            filters.push(eq(contractTemplatePermissionsTable.methodSelector, methodSelector));
        }

        const identityQuery = this.db
            .select({ ...getTableColumns(contractTemplatePermissionsTable) })
            .from(contractTemplatePermissionsTable)
            .$dynamic();

        if (roleId !== undefined) {
            identityQuery.innerJoin(
                contractTemplatePermissionRolesTable,
                eq(contractTemplatePermissionsTable.id, contractTemplatePermissionRolesTable.permissionId)
            );
            filters.push(eq(contractTemplatePermissionRolesTable.roleId, roleId));
        }

        identityQuery.where(and(...filters));

        const rowCount = await this.db
            .select({ count: count() })
            .from(identityQuery.as('sq'))
            .then((res) => res[0]?.count ?? 0);

        const subquery = identityQuery
            .limit(limit)
            .offset(offset)
            .orderBy(asc(contractTemplatePermissionsTable.templateId), desc(contractTemplatePermissionsTable.createdAt))
            .as('templatePermission');

        const rawItems = await this.db
            .select()
            .from(subquery)
            .leftJoin(
                contractTemplatePermissionRolesTable,
                eq(subquery.id, contractTemplatePermissionRolesTable.permissionId)
            )
            .leftJoin(rolesTable, eq(contractTemplatePermissionRolesTable.roleId, rolesTable.id))
            .leftJoin(
                contractTemplateArgumentRestrictionsTable,
                eq(subquery.id, contractTemplateArgumentRestrictionsTable.permissionId)
            );

        // Build response schema from raw data. Accumulate items in a map to ensure insertion order.
        const itemMap = new Map<number, FullTemplatePermission>();
        // Track which roles and arguments have been added to prevent duplicates from cartesian product
        const addedRoles = new Map<number, Set<string>>();
        const addedArguments = new Map<number, Set<number>>();

        for (const rawItem of rawItems) {
            const permissionId = rawItem.templatePermission.id;
            const existing = itemMap.get(permissionId);
            const permissionRoleId = rawItem?.contract_template_permission_roles?.roleId;
            const roleName = rawItem?.roles?.roleName ?? undefined;
            const argumentIndex = rawItem?.contract_template_argument_restrictions?.argumentIndex;

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
                    ...rawItem.templatePermission,
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

    async findAllByTemplateId(templateId: number): Promise<(typeof contractTemplatePermissionsTable.$inferSelect)[]> {
        return this.db
            .select()
            .from(contractTemplatePermissionsTable)
            .where(eq(contractTemplatePermissionsTable.templateId, templateId));
    }

    async hasUmbrellaPermission(templateId: number): Promise<boolean> {
        const row = await this.db.query.contractTemplatePermissionsTable.findFirst({
            columns: { id: true },
            where: and(
                eq(contractTemplatePermissionsTable.templateId, templateId),
                eq(contractTemplatePermissionsTable.isUmbrella, true)
            )
        });
        return row !== undefined;
    }

    async findPermissionIdsWithUserRoles(permissionIds: number[], roleIds: string[]): Promise<Set<number>> {
        if (permissionIds.length === 0 || roleIds.length === 0) {
            return new Set();
        }

        const matches = await this.db
            .select({ permissionId: contractTemplatePermissionRolesTable.permissionId })
            .from(contractTemplatePermissionRolesTable)
            .where(
                and(
                    inArray(contractTemplatePermissionRolesTable.permissionId, permissionIds),
                    inArray(contractTemplatePermissionRolesTable.roleId, roleIds)
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
