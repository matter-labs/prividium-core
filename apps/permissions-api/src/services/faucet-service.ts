import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type { Repositories } from '../db';
import type { FaucetClaim } from '../repositories/faucet-claims-repository';
import type { User } from '../repositories/users-repository';
import type { PinoLogger } from '../utils/logger';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { userHasWallet } from '../utils/user-wallets';
import { viemErrorName } from '../utils/viem-error-name';

const ROLLING_DAILY_CAP_WINDOW_SECONDS = 24 * 60 * 60;

export type FaucetServiceConfig = {
    claimAmountWei: bigint;
    cooldownSeconds: number;
    /** Seconds after which a stranded `pending` row is treated as stale and ignored / auto-failed. */
    stalePendingSeconds: number;
    /** Rolling 24h cap on total in-flight + successful claims. Set to 0n to disable the global cap. */
    maxDailySpendWei: bigint;
    /** Max time to wait for `sendTransaction` receipt, in ms. */
    txTimeoutMs: number;
    /** Address of the operator wallet — surfaced via `GET /admin/faucet/status`. */
    operatorAddress: Address;
};

export type ClaimResult =
    | { kind: 'ok'; txHash: Hex; amountWei: bigint; nextEligibleAt: Date }
    | { kind: 'cooldown'; nextEligibleAt: Date }
    | { kind: 'dailyCap'; capResetsAt: Date }
    | { kind: 'walletNotAssociated' }
    | { kind: 'unavailable' }
    | { kind: 'txFailed' };

export type FaucetStatus = {
    nextEligibleAt: Date | null;
    lastSuccess: { createdAt: Date; walletAddress: Address; txHash: Hex | null } | null;
};

export type AdminFaucetStatus = {
    operatorAddress: Address;
    /** `null` when the upstream RPC could not be reached. Admin UI must render this as unavailable. */
    operatorBalanceWei: bigint | null;
    last24hSuccessWei: bigint;
    config: {
        claimAmountWei: bigint;
        cooldownSeconds: number;
        maxDailySpendWei: bigint;
    };
};

export class FaucetService {
    constructor(
        private readonly repos: Repositories,
        private readonly publicClient: PublicClient,
        private readonly walletClient: WalletClient,
        private readonly config: FaucetServiceConfig,
        private readonly logger: PinoLogger
    ) {}

    async claim(user: User, walletAddress: Address): Promise<ClaimResult> {
        if (!userHasWallet(user, walletAddress)) {
            return { kind: 'walletNotAssociated' };
        }

        const reservation = await this.repos.faucetClaims.reserveClaim({
            userId: user.id,
            walletAddress,
            amountWei: this.config.claimAmountWei,
            cooldownSeconds: this.config.cooldownSeconds,
            stalePendingSeconds: this.config.stalePendingSeconds,
            maxDailySpendWei: this.config.maxDailySpendWei,
            dailyCapWindowSeconds: ROLLING_DAILY_CAP_WINDOW_SECONDS
        });

        if (reservation.staleRecovered.length > 0) {
            this.logger.warn(
                { userId: user.id, recovered: reservation.staleRecovered },
                'faucet claim: recovered stale pending rows during reservation'
            );
        }

        if ('blockedBy' in reservation) {
            return {
                kind: 'cooldown',
                nextEligibleAt: this.computeNextEligibleAt(reservation.blockedBy.createdAt)
            };
        }
        if ('capReached' in reservation) {
            return { kind: 'dailyCap', capResetsAt: reservation.capReached.capResetsAt };
        }

        const claimId = reservation.reservedId;
        let txHash: Hex;
        try {
            txHash = await this.walletClient.sendTransaction({
                account: this.walletClient.account ?? null,
                chain: this.walletClient.chain ?? null,
                to: walletAddress,
                value: this.config.claimAmountWei
            });
        } catch (err) {
            this.logger.error(
                { err, errName: viemErrorName(err), claimId, walletAddress },
                'faucet claim: sendTransaction failed'
            );
            await this.safeMarkFailed(claimId, null);
            return { kind: 'unavailable' };
        }

        try {
            const receipt = await this.publicClient.waitForTransactionReceipt({
                hash: txHash,
                confirmations: 1,
                timeout: this.config.txTimeoutMs
            });
            if (receipt.status !== 'success') {
                this.logger.error({ claimId, txHash, walletAddress }, 'faucet claim: tx reverted on-chain');
                await this.safeMarkFailed(claimId, txHash);
                return { kind: 'txFailed' };
            }
        } catch (err) {
            this.logger.error(
                { err, errName: viemErrorName(err), claimId, txHash, walletAddress },
                'faucet claim: waitForTransactionReceipt failed'
            );
            await this.safeMarkFailed(claimId, txHash);
            return { kind: 'unavailable' };
        }

        try {
            await this.repos.faucetClaims.markSuccess(claimId, txHash);
        } catch (dbErr) {
            this.logger.error({ err: dbErr, claimId, txHash }, 'faucet claim: markSuccess DB write failed');
        }
        return {
            kind: 'ok',
            txHash,
            amountWei: this.config.claimAmountWei,
            nextEligibleAt: this.computeNextEligibleAt(new Date())
        };
    }

    async getStatus(userId: string): Promise<FaucetStatus> {
        const blocking = await this.repos.faucetClaims.latestBlockingByUser(
            userId,
            this.config.cooldownSeconds,
            this.config.stalePendingSeconds
        );
        const lastSuccess = await this.repos.faucetClaims.latestSuccessByUser(userId);
        return {
            nextEligibleAt: blocking ? this.computeNextEligibleAt(blocking.createdAt) : null,
            lastSuccess: lastSuccess
                ? {
                      createdAt: lastSuccess.createdAt,
                      walletAddress: lastSuccess.walletAddress,
                      txHash: lastSuccess.txHash
                  }
                : null
        };
    }

    async getAdminStatus(): Promise<AdminFaucetStatus> {
        let operatorBalanceWei: bigint | null;
        try {
            operatorBalanceWei = await this.publicClient.getBalance({ address: this.config.operatorAddress });
        } catch (err) {
            this.logger.error({ err, errName: viemErrorName(err) }, 'faucet admin status: getBalance failed');
            operatorBalanceWei = null;
        }
        const last24hSuccessWei = await this.repos.faucetClaims.sumSuccessWithin(ROLLING_DAILY_CAP_WINDOW_SECONDS);
        return {
            operatorAddress: this.config.operatorAddress,
            operatorBalanceWei,
            last24hSuccessWei,
            config: {
                claimAmountWei: this.config.claimAmountWei,
                cooldownSeconds: this.config.cooldownSeconds,
                maxDailySpendWei: this.config.maxDailySpendWei
            }
        };
    }

    async listClaims({ limit, offset }: PaginationParams): Promise<PaginatedResult<FaucetClaim>> {
        const [items, totalItems] = await Promise.all([
            this.repos.faucetClaims.listRecent({ limit, offset }),
            this.repos.faucetClaims.countAll()
        ]);
        const currentPage = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
        const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 1;
        return {
            items,
            pagination: { currentPage, totalPages, totalItems, limit, offset }
        };
    }

    private async safeMarkFailed(claimId: string, txHash: Hex | null): Promise<void> {
        try {
            await this.repos.faucetClaims.markFailed(claimId, txHash);
        } catch (dbErr) {
            this.logger.error({ err: dbErr, claimId, txHash }, 'faucet claim: markFailed DB write failed');
        }
    }

    private computeNextEligibleAt(from: Date): Date {
        return new Date(from.getTime() + this.config.cooldownSeconds * 1000);
    }
}
