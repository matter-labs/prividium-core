import { and, eq, gt } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import type { z } from 'zod/v4';
import { walletTransactionAllowancesTable } from '../db/schema';
import { createInsertSchema } from '../utils/drizzle-zod-schema-factory';
import { EntityNotFound } from '../utils/error-types';
import { hexSchema } from '../utils/schemas/hex-schema';
import { bigintUint256NumericSchema } from '../utils/schemas/numeric';
import { BaseRepository } from './base-repository';

export const CreateWalletTransactionAllowanceSchema = createInsertSchema(walletTransactionAllowancesTable).extend({
    transactionCalldata: hexSchema,
    walletAddress: hexSchema,
    toAddress: hexSchema.nullable(),
    transactionValue: bigintUint256NumericSchema,
    transactionHash: hexSchema.nullable().optional()
});

export type NewWalletTransactionAllowance = z.infer<typeof CreateWalletTransactionAllowanceSchema>;

export class WalletTransactionAllowancesRepository extends BaseRepository {
    async createOrUpdate(allowance: NewWalletTransactionAllowance): Promise<void> {
        await this.db
            .insert(walletTransactionAllowancesTable)
            .values({
                userId: allowance.userId,
                walletAddress: allowance.walletAddress,
                toAddress: allowance.toAddress,
                transactionNonce: allowance.transactionNonce,
                transactionCalldata: allowance.transactionCalldata,
                transactionValue: allowance.transactionValue,
                activeUntil: allowance.activeUntil
            })
            .onConflictDoUpdate({
                target: [
                    walletTransactionAllowancesTable.userId,
                    walletTransactionAllowancesTable.walletAddress,
                    walletTransactionAllowancesTable.transactionNonce
                ],
                set: {
                    toAddress: allowance.toAddress,
                    transactionCalldata: allowance.transactionCalldata,
                    transactionValue: allowance.transactionValue,
                    activeUntil: allowance.activeUntil,
                    updatedAt: new Date()
                }
            });
    }

    async findByUserAndWalletAndNonce(
        userId: string,
        walletAddress: Address,
        nonce: number
    ): Promise<typeof walletTransactionAllowancesTable.$inferSelect | undefined> {
        const now = new Date();
        return this.db.query.walletTransactionAllowancesTable.findFirst({
            where: and(
                eq(walletTransactionAllowancesTable.userId, userId),
                eq(walletTransactionAllowancesTable.walletAddress, walletAddress),
                eq(walletTransactionAllowancesTable.transactionNonce, nonce),
                gt(walletTransactionAllowancesTable.activeUntil, now)
            )
        });
    }

    async latestForUser(userId: string): Promise<typeof walletTransactionAllowancesTable.$inferSelect | undefined> {
        const now = new Date();
        return this.db.query.walletTransactionAllowancesTable.findFirst({
            where: and(
                eq(walletTransactionAllowancesTable.userId, userId),
                gt(walletTransactionAllowancesTable.activeUntil, now)
            ),
            orderBy: (f, { desc }) => {
                return [desc(f.createdAt)];
            }
        });
    }

    async updateTransactionHash(
        userId: string,
        walletAddress: Address,
        nonce: number,
        calldata: Hex,
        transactionHash: Hex,
        value: bigint
    ): Promise<void> {
        const now = new Date();
        const res = await this.db
            .update(walletTransactionAllowancesTable)
            .set({
                transactionHash
            })
            .where(
                and(
                    eq(walletTransactionAllowancesTable.userId, userId),
                    eq(walletTransactionAllowancesTable.walletAddress, walletAddress),
                    eq(walletTransactionAllowancesTable.transactionNonce, nonce),
                    eq(walletTransactionAllowancesTable.transactionCalldata, calldata),
                    eq(walletTransactionAllowancesTable.transactionValue, value),
                    gt(walletTransactionAllowancesTable.activeUntil, now)
                )
            )
            .returning();
        if (res.length === 0) {
            throw new EntityNotFound('Allowance', { userId, walletAddress, nonce });
        }
    }
}
