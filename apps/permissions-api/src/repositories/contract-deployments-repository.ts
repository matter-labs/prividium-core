import { and, count, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Address } from 'viem';
import { z } from 'zod/v4';
import { contractDeploymentsTable } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { createInsertSchema, createSelectSchema } from '../utils/drizzle-zod-schema-factory';
import { EntityNotFound } from '../utils/error-types';
import { hexSchema } from '../utils/schemas/hex-schema';
import type { PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';

const createContractDeploymentSchema = createInsertSchema(contractDeploymentsTable).extend({
    address: hexSchema,
    deployerAddress: hexSchema,
    deployTxHash: hexSchema,
    deployedBy: z.string().optional()
});
export type CreateContractDeployment = z.infer<typeof createContractDeploymentSchema>;

export const contractDeploymentSchema = createSelectSchema(contractDeploymentsTable).extend({
    address: hexSchema,
    deployerAddress: hexSchema,
    deployTxHash: hexSchema
});
export type ContractDeployment = z.infer<typeof contractDeploymentSchema>;

export class ContractDeploymentsRepository extends BaseRepository {
    async create(data: CreateContractDeployment): Promise<ContractDeployment> {
        return this.transaction(async (tx) => {
            const deployedBy =
                data.deployedBy !== undefined
                    ? data.deployedBy
                    : await tx
                          .repositories()
                          .users.findByAddress(data.deployerAddress)
                          .then((u) => {
                              if (u === undefined) {
                                  throw new EntityNotFound('user', { address: data.deployerAddress });
                              }
                              return u.id;
                          });

            const contract = await tx
                .insert(contractDeploymentsTable)
                .values({ ...data, deployedBy })
                .returning()
                .then(getFirstOrThrow);

            return contract;
        });
    }

    /**
     * Marks the deployment successful. Idempotent on the success state so
     * concurrent reconciliation paths can converge on the same pending row
     * without racing each other: an atomic conditional UPDATE transitions
     * the row only when it is still pending, and a re-read returns the
     * existing row if another caller won the race. Still throws if the
     * deployment is already errored, since that's a real state-machine
     * violation, not a race.
     */
    async success(id: ContractDeployment['id']): Promise<ContractDeployment> {
        return this.transaction(async (tx) => {
            const updated = await tx
                .update(contractDeploymentsTable)
                .set({ successAt: new Date() })
                .where(
                    and(
                        eq(contractDeploymentsTable.id, id),
                        isNull(contractDeploymentsTable.successAt),
                        isNull(contractDeploymentsTable.erroredAt)
                    )
                )
                .returning();

            if (updated.length > 0) {
                return updated[0]!;
            }

            const deployment = await tx.query.contractDeploymentsTable.findFirst({
                where: (f, { eq }) => eq(f.id, id)
            });

            if (deployment === undefined) {
                throw new EntityNotFound('ContractDeployment', { id });
            }

            if (deployment.successAt !== null) {
                return deployment;
            }

            throw new Error('Cannot mark an errored deployment as successful.');
        });
    }

    /**
     * Atomic conditional UPDATE, like `success()`: a row resolved by a
     * concurrent reconciler between read and write must not be stamped
     * errored, or the retention sweep would purge a successful deployment.
     */
    async error(id: ContractDeployment['id'], errorMsg: string): Promise<ContractDeployment> {
        return this.transaction(async (tx) => {
            const updated = await tx
                .update(contractDeploymentsTable)
                .set({ erroredAt: new Date(), errorMessage: errorMsg })
                .where(
                    and(
                        eq(contractDeploymentsTable.id, id),
                        isNull(contractDeploymentsTable.successAt),
                        isNull(contractDeploymentsTable.erroredAt)
                    )
                )
                .returning();

            if (updated.length > 0) {
                return updated[0]!;
            }

            const deployment = await tx.query.contractDeploymentsTable.findFirst({
                where: (f, { eq }) => eq(f.id, id)
            });

            if (deployment === undefined) {
                throw new EntityNotFound('ContractDeployment', { id });
            }

            throw new Error('Cannot resolve a contract deployment that was already resolved.');
        });
    }

    async searchPaginated(params: PaginationParams) {
        const { limit, offset } = params;

        // Get paginated items
        const items = await this.db.query.contractDeploymentsTable.findMany({
            limit,
            offset
        });

        const countResult = await this.db.select({ count: count() }).from(contractDeploymentsTable);

        const totalItems = Number(countResult[0]?.count || 0);

        // Calculate pagination metadata
        const currentPage = Math.floor(offset / limit) + 1;
        const totalPages = Math.ceil(totalItems / limit);

        return {
            items,
            pagination: {
                currentPage,
                totalPages,
                totalItems,
                limit,
                offset
            }
        };
    }

    async findByAddress(address: Address): Promise<ContractDeployment | undefined> {
        return this.db.query.contractDeploymentsTable.findFirst({
            where: (t, { eq, and }) => and(eq(t.address, address), isNotNull(t.successAt))
        });
    }

    /**
     * Pending = `startedAt` set but neither `successAt` nor `erroredAt`. Used
     * by authorship reconciliation when a sync deploy hit an EIP-7966 timeout:
     * the row exists with the deploy tx hash recorded, but no success was
     * marked because the chain hadn't mined the block yet.
     *
     * Returns all pending rows for the address, most recent first. There can
     * be more than one after a timeout-plus-retry sequence (each replacement
     * attempt creates its own row); the caller iterates until it finds the
     * one whose tx mined. Ordering puts the most likely candidate first.
     */
    async findAllPendingByAddress(address: Address): Promise<ContractDeployment[]> {
        return this.db.query.contractDeploymentsTable.findMany({
            where: (t, { eq, and, isNull }) => and(eq(t.address, address), isNull(t.successAt), isNull(t.erroredAt)),
            orderBy: (t, { desc }) => [desc(t.startedAt)]
        });
    }

    /**
     * Oldest pending rows whose `startedAt` is older than the cutoff, capped
     * at `limit`. The cleanup cron reconciles each against the chain before
     * erroring it, so rows whose tx never mines don't accumulate forever.
     */
    async findStalePending(olderThan: Date, limit: number): Promise<ContractDeployment[]> {
        return this.db.query.contractDeploymentsTable.findMany({
            where: (t, { and, isNull, lt }) =>
                and(isNull(t.successAt), isNull(t.erroredAt), lt(t.startedAt, olderThan)),
            orderBy: (t, { asc }) => [asc(t.startedAt)],
            limit
        });
    }

    /**
     * Deletes errored rows whose `erroredAt` is older than the cutoff.
     * Retention window for forensics; after that the row is purged so the
     * table stays bounded by (deploy traffic) × (retention).
     */
    async deleteErroredBefore(olderThan: Date): Promise<number> {
        const deleted = await this.db
            .delete(contractDeploymentsTable)
            .where(
                and(isNotNull(contractDeploymentsTable.erroredAt), lt(contractDeploymentsTable.erroredAt, olderThan))
            )
            .returning({ id: contractDeploymentsTable.id });
        return deleted.length;
    }
}
