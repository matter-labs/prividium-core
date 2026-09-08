import { subSeconds } from 'date-fns';
import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import type { DbOrTx } from '../db';
import { faucetClaimsTable } from '../db/schema';
import { InternalServerError } from '../utils/error-types';
import { BaseRepository } from './base-repository';

export type FaucetClaim = typeof faucetClaimsTable.$inferSelect;

export type StaleRecoveredRow = { id: string; txHash: Hex | null };

export type ReserveClaimResult =
    | { reservedId: string; staleRecovered: StaleRecoveredRow[] }
    | { blockedBy: FaucetClaim; staleRecovered: StaleRecoveredRow[] }
    | { capReached: { capResetsAt: Date }; staleRecovered: StaleRecoveredRow[] };

// Postgres advisory lock key for serializing rolling-window cap checks.
// Concurrent claims from different users would otherwise each read the same
// SUM(amount_wei) before either inserts, allowing the global cap to be exceeded
// by (N-1) * claimAmountWei. Holding this xact-scoped lock around the cap
// SELECT + INSERT linearises the check; the lock is released on commit.
const FAUCET_CAP_ADVISORY_LOCK_ID = 0xfacef;

export class FaucetClaimsRepository extends BaseRepository {
    /**
     * Reserve a new `pending` claim for `userId` if no blocking claim exists
     * and the rolling-window daily cap permits.
     */
    async reserveClaim({
        amountWei,
        cooldownSeconds,
        dailyCapWindowSeconds,
        maxDailySpendWei,
        stalePendingSeconds,
        userId,
        walletAddress
    }: {
        userId: string;
        walletAddress: Address;
        amountWei: bigint;
        cooldownSeconds: number;
        stalePendingSeconds: number;
        maxDailySpendWei: bigint;
        dailyCapWindowSeconds: number;
    }): Promise<ReserveClaimResult> {
        return this.transaction(async (tx) => {
            const stalePendingThreshold = subSeconds(new Date(), stalePendingSeconds);

            // Recover from any prior crash that left a pending row stranded — otherwise the
            // unique index would block this user until the row is cleaned up. Caller logs
            // any rows surfaced here so operators can reconcile with on-chain state.
            const staleRecovered = await tx
                .update(faucetClaimsTable)
                .set({ status: 'failed' })
                .where(
                    and(
                        eq(faucetClaimsTable.userId, userId),
                        eq(faucetClaimsTable.status, 'pending'),
                        lt(faucetClaimsTable.createdAt, stalePendingThreshold)
                    )
                )
                .returning({ id: faucetClaimsTable.id, txHash: faucetClaimsTable.txHash });

            const blocker = await this.findLatestBlockingByUser(tx, userId, cooldownSeconds, stalePendingSeconds);
            if (blocker) {
                return { blockedBy: blocker, staleRecovered };
            }

            if (maxDailySpendWei > 0n) {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(${FAUCET_CAP_ADVISORY_LOCK_ID})`);

                const capThreshold = subSeconds(new Date(), dailyCapWindowSeconds);
                const [capRow] = await tx
                    .select({
                        total: sql<string | null>`COALESCE(SUM(${faucetClaimsTable.amountWei}), 0)`
                    })
                    .from(faucetClaimsTable)
                    .where(
                        and(
                            inArray(faucetClaimsTable.status, ['pending', 'success']),
                            gt(faucetClaimsTable.createdAt, capThreshold)
                        )
                    );
                const inFlightOrSpent = capRow?.total ? BigInt(capRow.total) : 0n;
                if (inFlightOrSpent + amountWei > maxDailySpendWei) {
                    return {
                        capReached: { capResetsAt: new Date(Date.now() + dailyCapWindowSeconds * 1000) },
                        staleRecovered
                    };
                }
            }

            // Race recovery: if a concurrent request wins the pending slot between our
            // blocker check and this insert, the partial unique index rejects ours.
            // ON CONFLICT DO NOTHING + RETURNING lets us detect the race without aborting
            // the transaction.
            const [created] = await tx
                .insert(faucetClaimsTable)
                .values({ userId, walletAddress, amountWei, status: 'pending' })
                .onConflictDoNothing()
                .returning();
            if (created) {
                return { reservedId: created.id, staleRecovered };
            }

            const winner = await this.findLatestBlockingByUser(tx, userId, cooldownSeconds, stalePendingSeconds);
            if (winner) {
                return { blockedBy: winner, staleRecovered };
            }
            // No row inserted and no blocker visible — likely the winning row was finalized
            // and aged out of the cooldown window in the same instant. Surface as a typed
            // 500 so the user sees a clear message and ops sees a structured error code.
            throw new InternalServerError('Concurrent claim conflict, please retry shortly.');
        });
    }

    async markSuccess(id: string, txHash: Hex): Promise<void> {
        await this.db.update(faucetClaimsTable).set({ status: 'success', txHash }).where(eq(faucetClaimsTable.id, id));
    }

    async markFailed(id: string, txHash: Hex | null): Promise<void> {
        await this.db.update(faucetClaimsTable).set({ status: 'failed', txHash }).where(eq(faucetClaimsTable.id, id));
    }

    async sumSuccessWithin(windowSeconds: number): Promise<bigint> {
        const threshold = subSeconds(new Date(), windowSeconds);
        const [row] = await this.db
            .select({
                total: sql<string | null>`COALESCE(SUM(${faucetClaimsTable.amountWei}), 0)`
            })
            .from(faucetClaimsTable)
            .where(and(eq(faucetClaimsTable.status, 'success'), gt(faucetClaimsTable.createdAt, threshold)));
        return row?.total ? BigInt(row.total) : 0n;
    }

    async latestBlockingByUser(
        userId: string,
        cooldownSeconds: number,
        stalePendingSeconds: number
    ): Promise<FaucetClaim | undefined> {
        return this.findLatestBlockingByUser(this.db, userId, cooldownSeconds, stalePendingSeconds);
    }

    private async findLatestBlockingByUser(
        db: DbOrTx,
        userId: string,
        cooldownSeconds: number,
        stalePendingSeconds: number
    ): Promise<FaucetClaim | undefined> {
        const now = new Date();
        const cooldownThreshold = subSeconds(now, cooldownSeconds);
        const stalePendingThreshold = subSeconds(now, stalePendingSeconds);
        const [row] = await db
            .select()
            .from(faucetClaimsTable)
            .where(
                and(
                    eq(faucetClaimsTable.userId, userId),
                    or(
                        and(
                            eq(faucetClaimsTable.status, 'success'),
                            gt(faucetClaimsTable.createdAt, cooldownThreshold)
                        ),
                        and(
                            eq(faucetClaimsTable.status, 'pending'),
                            gt(faucetClaimsTable.createdAt, stalePendingThreshold)
                        )
                    )
                )
            )
            .orderBy(desc(faucetClaimsTable.createdAt))
            .limit(1);
        return row;
    }

    async latestSuccessByUser(userId: string): Promise<FaucetClaim | undefined> {
        const [row] = await this.db
            .select()
            .from(faucetClaimsTable)
            .where(and(eq(faucetClaimsTable.userId, userId), eq(faucetClaimsTable.status, 'success')))
            .orderBy(desc(faucetClaimsTable.createdAt))
            .limit(1);
        return row;
    }

    async listRecent(opts: { limit: number; offset: number }): Promise<FaucetClaim[]> {
        return this.db
            .select()
            .from(faucetClaimsTable)
            .orderBy(desc(faucetClaimsTable.createdAt))
            .limit(opts.limit)
            .offset(opts.offset);
    }

    async countAll(): Promise<number> {
        const [row] = await this.db.select({ total: sql<string>`COUNT(*)` }).from(faucetClaimsTable);
        return row?.total ? Number(row.total) : 0;
    }
}
