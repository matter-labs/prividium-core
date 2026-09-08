import { pino } from 'pino';
import { type Address, type Hex, pad, parseEther } from 'viem';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { faucetClaimsTable } from '../db/schema';
import { type User, UsersRepository } from '../repositories/users-repository';
import { FaucetService, type FaucetServiceConfig } from './faucet-service';

const TEST_TX_HASH = pad('0x01', { size: 32 });
const OPERATOR_ADDRESS = pad('0xaa', { size: 20 });
const DEFAULT_CONFIG: FaucetServiceConfig = {
    claimAmountWei: parseEther('0.05'),
    cooldownSeconds: 86_400,
    stalePendingSeconds: 3_600,
    maxDailySpendWei: parseEther('5'),
    txTimeoutMs: 5_000,
    operatorAddress: OPERATOR_ADDRESS
};

type MockClients = {
    publicClient: {
        getBalance: ReturnType<typeof vi.fn>;
        waitForTransactionReceipt: ReturnType<typeof vi.fn>;
    };
    walletClient: {
        sendTransaction: ReturnType<typeof vi.fn>;
        account: null;
        chain: null;
    };
};

function buildClients(overrides: Partial<MockClients['publicClient'] & MockClients['walletClient']> = {}): MockClients {
    return {
        publicClient: {
            getBalance: vi.fn(async () => 10_000_000_000_000_000_000n),
            waitForTransactionReceipt:
                overrides.waitForTransactionReceipt ??
                vi.fn(async () => ({ status: 'success' as const, transactionHash: TEST_TX_HASH }))
        },
        walletClient: {
            sendTransaction: overrides.sendTransaction ?? vi.fn(async () => TEST_TX_HASH),
            account: null,
            chain: null
        }
    };
}

function buildService(
    repos: Repositories,
    clients: MockClients,
    configOverrides: Partial<FaucetServiceConfig> = {}
): FaucetService {
    return new FaucetService(
        repos,
        // biome-ignore lint/suspicious/noExplicitAny: test mocks
        clients.publicClient as any,
        // biome-ignore lint/suspicious/noExplicitAny: test mocks
        clients.walletClient as any,
        { ...DEFAULT_CONFIG, ...configOverrides },
        pino({ level: 'silent' })
    );
}

describe('FaucetService', () => {
    let repos: Repositories;
    let userRepo: UsersRepository;
    let userWithWallet: User;
    const userWallet: Address = pad('0xbb', { size: 20 });
    const strangerWallet: Address = pad('0xcc', { size: 20 });

    beforeEach<Fixture>(async ({ db }) => {
        repos = new Repositories(db);
        userRepo = new UsersRepository(db);
        userWithWallet = await userRepo.create({
            displayName: 'Test User',
            roles: [],
            wallets: [userWallet],
            source: 'adminPanel'
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('rejects when the wallet is not associated with the caller', async ({ db }) => {
        const clients = buildClients();
        const service = buildService(repos, clients);

        const res = await service.claim(userWithWallet, strangerWallet);

        expect(res).toEqual({ kind: 'walletNotAssociated' });
        expect(clients.walletClient.sendTransaction).not.toHaveBeenCalled();
        const rows = await db.select().from(faucetClaimsTable);
        expect(rows).toHaveLength(0);
    });

    it('happy path: sends tx, waits for receipt, marks the claim successful', async ({ db }) => {
        const clients = buildClients();
        const service = buildService(repos, clients);

        const res = await service.claim(userWithWallet, userWallet);

        expect(res.kind).toBe('ok');
        if (res.kind !== 'ok') throw new Error('unreachable');
        expect(res.txHash).toBe(TEST_TX_HASH);
        expect(res.amountWei).toBe(DEFAULT_CONFIG.claimAmountWei);
        expect(clients.walletClient.sendTransaction).toHaveBeenCalledWith(
            expect.objectContaining({ to: userWallet, value: DEFAULT_CONFIG.claimAmountWei })
        );
        expect(clients.publicClient.waitForTransactionReceipt).toHaveBeenCalled();

        const rows = await db.select().from(faucetClaimsTable);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('success');
        expect(rows[0]?.txHash).toBe(TEST_TX_HASH);
    });

    it('returns cooldown with nextEligibleAt when a recent successful claim exists', async ({ db }) => {
        const clients = buildClients();
        const service = buildService(repos, clients);

        const first = await service.claim(userWithWallet, userWallet);
        expect(first.kind).toBe('ok');

        const second = await service.claim(userWithWallet, userWallet);
        expect(second.kind).toBe('cooldown');
        if (second.kind !== 'cooldown') throw new Error('unreachable');
        expect(second.nextEligibleAt.getTime()).toBeGreaterThan(Date.now());

        expect(clients.walletClient.sendTransaction).toHaveBeenCalledTimes(1);
        const rows = await db.select().from(faucetClaimsTable);
        expect(rows).toHaveLength(1);
    });

    it('returns dailyCap when the rolling 24h cap would be exceeded', async () => {
        const clients = buildClients();
        // Cap so tight the first claim already exceeds it.
        const service = buildService(repos, clients, {
            maxDailySpendWei: DEFAULT_CONFIG.claimAmountWei - 1n
        });

        const res = await service.claim(userWithWallet, userWallet);

        expect(res.kind).toBe('dailyCap');
        expect(clients.walletClient.sendTransaction).not.toHaveBeenCalled();
    });

    it('skips the daily cap check when maxDailySpendWei is 0', async () => {
        const clients = buildClients();
        const service = buildService(repos, clients, { maxDailySpendWei: 0n });

        const res = await service.claim(userWithWallet, userWallet);

        expect(res.kind).toBe('ok');
        expect(clients.walletClient.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('marks the claim failed and returns unavailable when sendTransaction throws', async ({ db }) => {
        const clients = buildClients({
            sendTransaction: vi.fn(async () => {
                throw new Error('insufficient funds for gas');
            })
        });
        const service = buildService(repos, clients);

        const res = await service.claim(userWithWallet, userWallet);

        expect(res.kind).toBe('unavailable');
        const rows = await db.select().from(faucetClaimsTable);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('failed');
        expect(rows[0]?.txHash).toBeNull();
    });

    it('marks the claim failed and returns txFailed on on-chain revert', async ({ db }) => {
        const clients = buildClients({
            waitForTransactionReceipt: vi.fn(async () => ({
                status: 'reverted' as const,
                transactionHash: TEST_TX_HASH
            }))
        });
        const service = buildService(repos, clients);

        const res = await service.claim(userWithWallet, userWallet);

        expect(res.kind).toBe('txFailed');
        const rows = await db.select().from(faucetClaimsTable);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('failed');
        expect(rows[0]?.txHash).toBe(TEST_TX_HASH);
    });

    it('allows a second claim after a prior failure (cooldown did not consume)', async ({ db }) => {
        // First attempt fails
        let throwOnce = true;
        const clients = buildClients({
            sendTransaction: vi.fn(async () => {
                if (throwOnce) {
                    throwOnce = false;
                    throw new Error('insufficient funds');
                }
                return TEST_TX_HASH as Hex;
            })
        });
        const service = buildService(repos, clients);

        const firstAttempt = await service.claim(userWithWallet, userWallet);
        expect(firstAttempt.kind).toBe('unavailable');

        // Immediately retry — cooldown should not block since the prior row is `failed`.
        const secondAttempt = await service.claim(userWithWallet, userWallet);
        expect(secondAttempt.kind).toBe('ok');

        const rows = await db.select().from(faucetClaimsTable);
        expect(rows).toHaveLength(2);
    });

    it('getStatus returns the next eligibility timestamp after a successful claim', async () => {
        const clients = buildClients();
        const service = buildService(repos, clients);

        await service.claim(userWithWallet, userWallet);
        const status = await service.getStatus(userWithWallet.id);

        expect(status.nextEligibleAt).not.toBeNull();
        expect(status.lastSuccess?.walletAddress).toBe(userWallet);
    });

    it('getAdminStatus combines on-chain balance with DB 24h spend', async () => {
        const clients = buildClients();
        clients.publicClient.getBalance = vi.fn(async () => 7_777_777n);
        const service = buildService(repos, clients);

        await service.claim(userWithWallet, userWallet);

        const status = await service.getAdminStatus();
        expect(status.operatorBalanceWei).toBe(7_777_777n);
        expect(status.last24hSuccessWei).toBe(DEFAULT_CONFIG.claimAmountWei);
        expect(status.operatorAddress).toBe(OPERATOR_ADDRESS);
    });
});
