import { subSeconds } from 'date-fns';
import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';
import type { Address, Hex } from 'viem';
import { type DB, type Repositories, runWithJobContext } from '../db';
import type { ExternalRpc } from '../rpc/target-rpc';
import { areHexEqual } from '../utils/hex';
import type { PinoLogger } from '../utils/logger';

const STALE_PENDING_REASON = 'TTL sweep: deploy tx did not land within the pending window';
const JOB_ID = 'deployment-cleanup';
/** Bounds per-tick work; the backlog drains across ticks, oldest rows first. */
const SWEEP_BATCH_LIMIT = 100;
/** Stops the tick early when the upstream is evidently down. */
const MAX_CONSECUTIVE_FETCH_FAILURES = 3;

export type SweepDeps = {
    repos: Repositories;
    chainRpc: Pick<ExternalRpc, 'deployReceiptContractAddress' | 'transactionIsKnown'>;
    logger: PinoLogger;
};

type Deps = Omit<SweepDeps, 'repos'> & {
    db: DB;
    /** Reconciles-then-errors pending rows whose `startedAt` is older than this. */
    pendingTtlSeconds: number;
    /** Deletes errored rows whose `erroredAt` is older than this. */
    erroredRetentionSeconds: number;
    intervalSeconds: number;
};

/**
 * Resolves stale pending rows against the chain: mined at the predicted
 * address → success; still known to the node or chain unreachable → kept for
 * the next sweep; dropped or reverted → errored. Erroring a mined deploy
 * would permanently strip the deployer's authorship.
 */
export async function sweepStalePendingDeployments(
    deps: SweepDeps,
    olderThan: Date
): Promise<{ promoted: number; errored: number; skipped: number }> {
    const outcome = { promoted: 0, errored: 0, skipped: 0 };
    const stale = await deps.repos.contractDeployments.findStalePending(olderThan, SWEEP_BATCH_LIMIT);
    let consecutiveFetchFailures = 0;

    for (const row of stale) {
        let verdict: 'mined' | 'waiting' | 'gone';
        try {
            const receiptAddress: Address | null = await deps.chainRpc.deployReceiptContractAddress(
                `${JOB_ID}_receipt_${row.id}`,
                row.deployTxHash as Hex
            );
            if (receiptAddress !== null && areHexEqual(receiptAddress, row.address as Hex)) {
                verdict = 'mined';
            } else if (
                receiptAddress === null &&
                (await deps.chainRpc.transactionIsKnown(`${JOB_ID}_tx_${row.id}`, row.deployTxHash as Hex))
            ) {
                // Still in the mempool, or mined between the two calls.
                verdict = 'waiting';
            } else {
                verdict = 'gone';
            }
            consecutiveFetchFailures = 0;
        } catch (err) {
            outcome.skipped++;
            deps.logger.warn({ err, deploymentId: row.id }, 'Deployment cleanup: chain lookup failed, row kept');
            if (++consecutiveFetchFailures >= MAX_CONSECUTIVE_FETCH_FAILURES) {
                deps.logger.warn({ consecutiveFetchFailures }, 'Deployment cleanup: upstream down, aborting tick');
                break;
            }
            continue;
        }

        if (verdict === 'waiting') {
            outcome.skipped++;
            continue;
        }

        try {
            if (verdict === 'mined') {
                await deps.repos.contractDeployments.success(row.id);
                outcome.promoted++;
            } else {
                await deps.repos.contractDeployments.error(row.id, STALE_PENDING_REASON);
                outcome.errored++;
            }
        } catch (err) {
            // Lost a race with the lazy reconciler in checkContractAuthorship.
            outcome.skipped++;
            deps.logger.warn({ err, deploymentId: row.id }, 'Deployment cleanup: row transition failed, row kept');
        }
    }

    return outcome;
}

/**
 * Interval job closing both ends of the deployment-row lifecycle: stale
 * pending rows are reconciled or errored (see {@link sweepStalePendingDeployments}),
 * old errored rows are deleted after the retention window.
 */
export function createDeploymentCleanupJob(deps: Deps): SimpleIntervalJob {
    const logger = deps.logger.child({ role: 'DeploymentCleanup' });

    const task = new AsyncTask(
        'cleanup-deployments',
        () =>
            runWithJobContext(deps.db, JOB_ID, async (scopedDb) => {
                const repos = scopedDb.repositories();
                const [staleResult, retentionResult] = await Promise.allSettled([
                    sweepStalePendingDeployments(
                        { repos, chainRpc: deps.chainRpc, logger },
                        subSeconds(new Date(), deps.pendingTtlSeconds)
                    ),
                    repos.contractDeployments.deleteErroredBefore(subSeconds(new Date(), deps.erroredRetentionSeconds))
                ]);

                if (staleResult.status === 'fulfilled') {
                    logger.debug(staleResult.value, 'Stale pending deployment cleanup completed');
                } else {
                    logger.warn({ err: staleResult.reason }, 'Stale pending deployment cleanup failed');
                }

                if (retentionResult.status === 'fulfilled') {
                    logger.debug(
                        { deletedCount: retentionResult.value },
                        'Errored deployment retention sweep completed'
                    );
                } else {
                    logger.warn({ err: retentionResult.reason }, 'Errored deployment retention sweep failed');
                }
            }),
        (err) => logger.warn({ err }, 'Deployment cleanup failed')
    );

    return new SimpleIntervalJob({ seconds: deps.intervalSeconds }, task, { preventOverrun: true });
}
