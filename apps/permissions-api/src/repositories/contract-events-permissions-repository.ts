import { and, asc, count, eq, getTableColumns, inArray } from 'drizzle-orm';
import { type Hex, size } from 'viem';
import { extractForeignKeyConstraintProblem, isForeignKeyConstraintError } from '../db/errors';
import { contractEventPermissionsRoles, contractEventPermissionsTable, topicConditionEnum } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { abiFromString, abiHasEventSelector } from '../utils/abi';
import { EntityNotFound, InvalidInputError } from '../utils/error-types';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { EntityRepository } from './entity-repository';
import type { BareRole, Role } from './roles-repository';

const ContractEventsPermissionsRepositoryBase = EntityRepository({
    table: contractEventPermissionsTable,
    idColumn: contractEventPermissionsTable.id,
    entityName: 'Event permission',
    defaultOrderBy: [asc(contractEventPermissionsTable.createdAt), asc(contractEventPermissionsTable.id)]
});

type EventPermission = typeof contractEventPermissionsTable.$inferSelect & { roles: BareRole[] };

export type InsertEventPermission = typeof contractEventPermissionsTable.$inferInsert & {
    roles: Pick<Role, 'id'>[];
};

export type BarePermission = Omit<EventPermission, 'roles'>;

export class ContractEventsPermissionsRepository extends ContractEventsPermissionsRepositoryBase {
    async create(fields: InsertEventPermission): Promise<EventPermission> {
        await this.validateFields(fields);

        return this.transaction(async (tx) => {
            const newPermission = await tx
                .insert(contractEventPermissionsTable)
                .values({
                    contractAddress: fields.contractAddress,
                    topic0Constant: fields.topic0Constant,
                    topic1Constant: fields.topic1Constant,
                    topic2Constant: fields.topic2Constant,
                    topic3Constant: fields.topic3Constant,
                    topic1ConditionType: fields.topic1ConditionType,
                    topic2ConditionType: fields.topic2ConditionType,
                    topic3ConditionType: fields.topic3ConditionType,
                    organizationOnly: fields.organizationOnly
                })
                .returning()
                .then(getFirstOrThrow);

            if (fields.roles.length !== 0) {
                try {
                    await tx.insert(contractEventPermissionsRoles).values(
                        fields.roles.map(({ id }) => ({
                            roleId: id,
                            eventPermissionId: newPermission.id
                        }))
                    );
                } catch (e) {
                    if (isForeignKeyConstraintError(e)) {
                        throw new EntityNotFound('Role', { id: extractForeignKeyConstraintProblem(e) });
                    }
                    throw e;
                }
            }

            return tx.repositories().contractEventsPermissions.getById(newPermission.id);
        });
    }

    async findPaginated({
        limit,
        offset,
        contractAddress
    }: PaginationParams & {
        contractAddress?: Hex;
    }): Promise<PaginatedResult<EventPermission>> {
        const where = contractAddress ? eq(contractEventPermissionsTable.contractAddress, contractAddress) : undefined;
        const [items, totalCount] = await Promise.all([
            this.db.query.contractEventPermissionsTable.findMany({
                where,
                limit,
                offset,
                orderBy: [asc(contractEventPermissionsTable.createdAt), asc(contractEventPermissionsTable.id)],
                with: {
                    roles: {
                        with: { role: { columns: { id: true, roleName: true } } }
                    }
                }
            }),
            this.db.select({ count: count() }).from(contractEventPermissionsTable).where(where)
        ]);

        const totalItems = totalCount[0]?.count ?? 0;

        return {
            items: items.map((item) => ({ ...item, roles: item.roles.map((r) => r.role) })),
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalItems / limit),
                totalItems,
                limit,
                offset
            }
        };
    }

    async getById(id: string): Promise<EventPermission> {
        const result = await this.db.query.contractEventPermissionsTable.findFirst({
            where: eq(contractEventPermissionsTable.id, id),
            with: {
                roles: {
                    with: { role: { columns: { id: true, roleName: true } } }
                }
            }
        });

        if (result === undefined) {
            throw new EntityNotFound('Event permission', { id });
        }

        return { ...result, roles: result.roles.map((r) => r.role) };
    }

    async updateById(id: string, fields: InsertEventPermission): Promise<EventPermission> {
        await this.validateFields(fields);

        return this.transaction(async (tx) => {
            const existing = await tx.repositories().contractEventsPermissions.getById(id);
            const oldRoles = new Set(existing.roles.map((r) => r.id));
            const newRoles = new Set(fields.roles.map((r) => r.id));

            const [updated] = await tx
                .update(contractEventPermissionsTable)
                .set({
                    contractAddress: fields.contractAddress,
                    topic0Constant: fields.topic0Constant,
                    topic1Constant: fields.topic1Constant,
                    topic2Constant: fields.topic2Constant,
                    topic3Constant: fields.topic3Constant,
                    topic1ConditionType: fields.topic1ConditionType,
                    topic2ConditionType: fields.topic2ConditionType,
                    topic3ConditionType: fields.topic3ConditionType,
                    organizationOnly: fields.organizationOnly
                })
                .where(eq(contractEventPermissionsTable.id, id))
                .returning();

            if (!updated) {
                throw new EntityNotFound('Event permission', { id });
            }

            const rolesToTakeAway = [...oldRoles].filter((roleId) => !newRoles.has(roleId));
            await tx
                .delete(contractEventPermissionsRoles)
                .where(
                    and(
                        eq(contractEventPermissionsRoles.eventPermissionId, id),
                        inArray(contractEventPermissionsRoles.roleId, rolesToTakeAway)
                    )
                );

            const rolesToAssociate = [...newRoles].filter((roleId) => !oldRoles.has(roleId));

            if (rolesToAssociate.length !== 0) {
                await tx
                    .insert(contractEventPermissionsRoles)
                    .values(rolesToAssociate.map((roleId) => ({ roleId, eventPermissionId: id })));
            }

            return tx.repositories().contractEventsPermissions.getById(id);
        });
    }

    async deleteById(id: string): Promise<BarePermission> {
        return await this.transaction(async (tx) => {
            const [deleted] = await tx
                .delete(contractEventPermissionsTable)
                .where(eq(contractEventPermissionsTable.id, id))
                .returning();

            if (!deleted) {
                throw new EntityNotFound('Event permission', { id });
            }

            return deleted;
        });
    }

    private async validateFields(fields: InsertEventPermission): Promise<void> {
        const contract = await this.db.repositories().contracts.findByAddress(fields.contractAddress);
        const abi = abiFromString(contract.abi);
        if (fields.topic0Constant && !abiHasEventSelector(abi, fields.topic0Constant)) {
            throw new InvalidInputError(
                `event with selector=${fields.topic0Constant} not found for contract ${contract.name} (address=${contract.contractAddress})`
            );
        }

        const topics = [fields.topic1Constant, fields.topic2Constant, fields.topic3Constant];

        const badTopic = topics.find((t) => t && size(t) !== 32);
        if (badTopic !== undefined) {
            throw new InvalidInputError(`invalid topic: ${badTopic}`);
        }

        const topicChecks = [
            {
                type: fields.topic1ConditionType,
                constant: fields.topic1Constant
            },
            {
                type: fields.topic2ConditionType,
                constant: fields.topic2Constant
            },
            {
                type: fields.topic3ConditionType,
                constant: fields.topic3Constant
            }
        ];

        const mismatchType = topicChecks.some(
            ({ type, constant }) => type === 'userAddress' && constant !== null && constant !== undefined
        );
        if (mismatchType) {
            throw new InvalidInputError(`condition mismatch: user address check cannot have constant defined`);
        }

        const mismatchConstant = topicChecks.some(
            ({ type, constant }) =>
                type === topicConditionEnum.enum.equalTo && (constant === null || constant === undefined)
        );
        if (mismatchConstant) {
            throw new InvalidInputError(
                `condition mismatch: no constant for ${topicConditionEnum.enum.equalTo} condition`
            );
        }
    }

    async searchForContractAndRoles(contractAddresses: Hex[], roleIds: string[]): Promise<BarePermission[]> {
        return this.db
            .select(getTableColumns(contractEventPermissionsTable))
            .from(contractEventPermissionsTable)
            .innerJoin(
                contractEventPermissionsRoles,
                eq(contractEventPermissionsTable.id, contractEventPermissionsRoles.eventPermissionId)
            )
            .where(
                and(
                    inArray(contractEventPermissionsTable.contractAddress, contractAddresses),
                    inArray(contractEventPermissionsRoles.roleId, roleIds)
                )
            );
    }

    async searchForRoles(roleIds: string[]): Promise<BarePermission[]> {
        return this.db
            .selectDistinct(getTableColumns(contractEventPermissionsTable))
            .from(contractEventPermissionsTable)
            .innerJoin(
                contractEventPermissionsRoles,
                eq(contractEventPermissionsTable.id, contractEventPermissionsRoles.eventPermissionId)
            )
            .where(inArray(contractEventPermissionsRoles.roleId, roleIds));
    }
}
