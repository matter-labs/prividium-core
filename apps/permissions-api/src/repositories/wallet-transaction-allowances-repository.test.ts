import { type Address, getAddress, type Hex } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityNotFound } from '../utils/error-types';
import { ContractsRepository } from './contracts-repository';
import { type User, UsersRepository } from './users-repository';
import {
    type NewWalletTransactionAllowance,
    WalletTransactionAllowancesRepository
} from './wallet-transaction-allowances-repository';

describe('WalletTransactionAllowancesRepository', () => {
    let repository: WalletTransactionAllowancesRepository;
    let testUser: User;
    let otherUser: User;

    const walletA = randomAddress();
    const walletB = randomAddress();
    const walletOther = randomAddress();
    const contract1 = randomAddress();
    const contract2 = randomAddress();
    const calldata1 = `0x${'1'.repeat(64)}` as Hex;
    const calldata2 = `0x${'2'.repeat(64)}` as Hex;
    const nonZeroValue = 100000000000000n;
    const oddPaddedValue = 1000000000000000n;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new WalletTransactionAllowancesRepository(db);
        const usersRepository = new UsersRepository(db);
        const contractsRepository = new ContractsRepository(db);
        const [createdUser, createdOtherUser] = await Promise.all([
            usersRepository.create({
                displayName: 'Test User',
                oidcSub: 'oidc-sub-123',
                wallets: [walletA],
                source: 'adminPanel'
            }),
            usersRepository.create({
                displayName: 'Test User',
                oidcSub: 'oidc-sub-122',
                wallets: [walletOther],
                source: 'adminPanel'
            }),
            ...[contract1, contract2].map((address) =>
                contractsRepository.create({
                    contractAddress: address,
                    abi: JSON.stringify([]),
                    name: 'Test Token',
                    description: 'A test ERC20 token',
                    discloseErc20TotalSupply: false,
                    discloseBytecode: false,
                    disclosureStartBlock: '0x0'
                })
            )
        ]);
        testUser = createdUser;
        otherUser = createdOtherUser;
    });

    describe('createOrUpdate', () => {
        it('should insert', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 1,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000) // 1 minute in future
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 1);
            expect(found).toBeDefined();
            expect(found?.userId).toBe(testUser.id);
            expect(found?.walletAddress).toBe(walletA);
            expect(found?.transactionNonce).toBe(1);
            expect(found?.transactionCalldata).toBe(calldata1);
            expect(found?.toAddress).toBe(contract1);
        });

        it('should update existing allowance on conflict', async () => {
            const initial: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 2,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(initial);

            // update some fields for same user/wallet/nonce
            const updated: NewWalletTransactionAllowance = {
                ...initial,
                toAddress: contract2,
                transactionCalldata: calldata2,
                activeUntil: new Date(Date.now() + 120_000)
            };

            // small delay to ensure updatedAt differs if needed
            await new Promise((r) => setTimeout(r, 10));
            await repository.createOrUpdate(updated);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 2);
            expect(found).toBeDefined();
            expect(found?.toAddress).toBe(contract2);
            expect(found?.transactionCalldata).toBe(calldata2);
        });

        it('should update updatedAt when upserting existing allowance', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 3,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);
            const first = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 3);
            expect(first).toBeDefined();
            const firstUpdatedAt = first!.updatedAt;

            await new Promise((r) => setTimeout(r, 10));
            await repository.createOrUpdate({ ...allowance, activeUntil: new Date(Date.now() + 120_000) });

            const second = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 3);
            expect(second).toBeDefined();
            expect(second!.updatedAt.getTime()).toBeGreaterThan(firstUpdatedAt.getTime());
        });

        it('should allow contract deployment (toAddress 0x0000000000000000000000000000000000000000)', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: '0x0000000000000000000000000000000000000000',
                transactionNonce: 4,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 4);
            expect(found).toBeDefined();
            expect(found?.toAddress).toBe('0x0000000000000000000000000000000000000000');
        });

        it('should allow noop/ping (calldata 0x, value 0)', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 12,
                transactionCalldata: '0x0',
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 12);
            expect(found).toBeDefined();
            expect(found?.transactionCalldata).toBe('0x');
            expect(found?.transactionValue).toBe(0n);
        });

        it('should allow plain ETH transfer (calldata 0x, value > 0)', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 13,
                transactionCalldata: '0x0',
                transactionValue: nonZeroValue,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 13);
            expect(found).toBeDefined();
            expect(found?.transactionCalldata).toBe('0x');
            expect(found?.transactionValue === nonZeroValue).toBe(true);
        });

        it('should allow plain ETH transfer (calldata 0x, value > 0 - odd length)', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 13,
                transactionCalldata: '0x0',
                transactionValue: oddPaddedValue,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 13);
            expect(found).toBeDefined();
            expect(found?.transactionCalldata).toBe('0x');
            // Should decode to the same numeric value
            expect(BigInt(found?.transactionValue ?? 0)).toBe(BigInt(oddPaddedValue));
        });

        it('should allow contract call without value (calldata != 0x, value 0)', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 14,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 14);
            expect(found).toBeDefined();
            expect(found?.transactionCalldata).toBe(calldata1);
            expect(found?.transactionValue).toBe(0n);
        });

        it('should allow payable contract call (calldata != 0x, value > 0)', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 15,
                transactionCalldata: calldata1,
                transactionValue: nonZeroValue,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 15);
            expect(found).toBeDefined();
            expect(found?.transactionCalldata).toBe(calldata1);
            expect(found?.transactionValue).toBe(nonZeroValue);
        });

        it('should disallow negative transactionValue', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 16,
                transactionCalldata: calldata1,
                transactionValue: -100n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await expect(repository.createOrUpdate(allowance)).rejects.toThrow();
        });

        it('should disallow transaction value over max uint256', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 17,
                transactionCalldata: calldata1,
                transactionValue: 2n ** 256n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await expect(repository.createOrUpdate(allowance)).rejects.toThrow();
        });
    });

    describe('findByUserAndWalletAndNonce', () => {
        it('should not return expired allowances', async () => {
            const expired: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletB,
                toAddress: contract1,
                transactionNonce: 5,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() - 60_000) // expired
            };

            await repository.createOrUpdate(expired);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletB, 5);
            expect(found).toBeUndefined();
        });

        it('same nonce on different wallets should be independent', async () => {
            const nonce = 60;
            const a: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: nonce,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            const b: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletB,
                toAddress: contract2,
                transactionNonce: nonce,
                transactionCalldata: calldata2,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(a);
            await repository.createOrUpdate(b);

            // Update only walletB's transaction hash
            await repository.updateTransactionHash(testUser.id, walletB, nonce, calldata2, '0xb1', 0n);

            const foundA = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, nonce);
            const foundB = await repository.findByUserAndWalletAndNonce(testUser.id, walletB, nonce);

            expect(foundB?.transactionHash).toBe('0xb1');
            expect(foundA?.transactionHash).toBeNull();
        });

        it('should return undefined for non-existing nonce', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 6,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 999);
            expect(found).toBeUndefined();
        });

        it('should not leak allowances between different users', async () => {
            const otherUserAllowance: NewWalletTransactionAllowance = {
                userId: otherUser.id,
                walletAddress: walletOther,
                toAddress: contract1,
                transactionNonce: 7,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(otherUserAllowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletOther, 7);
            expect(found).toBeUndefined();
        });
    });

    describe('latestForUser', () => {
        it('should return the most recent active allowance', async () => {
            const a1: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 10,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            const a2: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletB,
                toAddress: contract2,
                transactionNonce: 11,
                transactionCalldata: calldata2,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(a1);
            // small delay to ensure ordering by createdAt
            await new Promise((r) => setTimeout(r, 10));
            await repository.createOrUpdate(a2);

            const latest = await repository.latestForUser(testUser.id);
            expect(latest).toBeDefined();
            expect(latest?.transactionNonce).toBe(11);
            expect(latest?.walletAddress).toBe(walletB);
        });

        it('should treat activeUntil === now as expired (boundary)', async () => {
            const now = new Date();
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 40,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: now
            };

            await repository.createOrUpdate(allowance);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 40);
            expect(found).toBeUndefined();
        });

        it('should ignore expired allowances even if created later', async () => {
            const active: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 50,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(active);
            // ensure expired is created later
            await new Promise((r) => setTimeout(r, 10));
            const expiredLater: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletB,
                toAddress: contract2,
                transactionNonce: 51,
                transactionCalldata: calldata2,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() - 60_000)
            };
            await repository.createOrUpdate(expiredLater);

            const latest = await repository.latestForUser(testUser.id);
            expect(latest).toBeDefined();
            expect(latest?.walletAddress).toBe(walletA);
            expect(latest?.transactionNonce).toBe(50);
        });

        it('should return undefined when user has no allowances', async () => {
            const latest = await repository.latestForUser('non-existent-user-id');
            expect(latest).toBeUndefined();
        });

        it('should return undefined when user only has expired allowances', async () => {
            const expired: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 70,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() - 60_000)
            };

            await repository.createOrUpdate(expired);

            const latest = await repository.latestForUser(testUser.id);
            expect(latest).toBeUndefined();
        });

        it('should order strictly by createdAt when multiple active allowances exist', async () => {
            const a1: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 80,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            const a2: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract2,
                transactionNonce: 81,
                transactionCalldata: calldata2,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(a2);
            await new Promise((r) => setTimeout(r, 10));
            await repository.createOrUpdate(a1);

            const latest = await repository.latestForUser(testUser.id);
            expect(latest).toBeDefined();
            expect(latest?.transactionNonce).toBe(80);
        });
    });

    describe('updateTransactionHash', () => {
        it('should set transactionHash when calldata matches', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 20,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            await repository.updateTransactionHash(testUser.id, walletA, 20, calldata1, '0xdeadbeef', 0n);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 20);
            expect(found).toBeDefined();
            expect(found?.transactionHash).toBe('0xdeadbeef');
        });

        it('should throw EntityNotFound when calldata mismatch or expired', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 30,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };

            await repository.createOrUpdate(allowance);

            // wrong calldata
            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 30, calldata2, '0x1', 0n)
            ).rejects.toThrow(EntityNotFound);

            // expired case
            const expired: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 31,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() - 60_000)
            };
            await repository.createOrUpdate(expired);
            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 31, calldata1, '0x2', 0n)
            ).rejects.toThrow(EntityNotFound);
        });

        it('should allow overwriting transactionHash when calldata matches', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 42,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await repository.updateTransactionHash(testUser.id, walletA, 42, calldata1, '0xaabb', 0n);
            await repository.updateTransactionHash(testUser.id, walletA, 42, calldata1, '0xccdd', 0n);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 42);
            expect(found?.transactionHash).toBe('0xccdd');
        });

        it('should throw EntityNotFound when allowance does not exist', async () => {
            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 9999, calldata1, '0xdead', 0n)
            ).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound when allowance belongs to another user', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: otherUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 90,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 90, calldata1, '0xdead', 0n)
            ).rejects.toThrow(EntityNotFound);
        });

        it('should be calldata case-insensitive when matching updateTransactionHash', async () => {
            const calldataUpper = `0x${'A'.repeat(64)}` as Hex;
            const calldataLower = `0x${'a'.repeat(64)}` as Hex;

            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 41,
                transactionCalldata: calldataUpper,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await repository.updateTransactionHash(testUser.id, walletA, 41, calldataLower, '0x01', 0n);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 41);
            expect(found?.transactionHash).toBe('0x01');
        });

        it('should set transactionHash when calldata is 0x0 and value is non-zero', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 100,
                transactionCalldata: '0x0',
                transactionValue: nonZeroValue,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await repository.updateTransactionHash(testUser.id, walletA, 100, '0x0', '0xc0ffee', nonZeroValue);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 100);
            expect(found?.transactionHash).toBe('0xc0ffee');
        });

        it('should set transactionHash when calldata and value are both 0x0', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 101,
                transactionCalldata: '0x0',
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await repository.updateTransactionHash(testUser.id, walletA, 101, '0x0', '0xbeef', 0n);

            const found = await repository.findByUserAndWalletAndNonce(testUser.id, walletA, 101);
            expect(found?.transactionHash).toBe('0xbeef');
        });

        it('should throw EntityNotFound when calldata matches but value does not', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 102,
                transactionCalldata: calldata1,
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 102, calldata1, '0xdead', nonZeroValue)
            ).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound when value matches but calldata does not', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 103,
                transactionCalldata: calldata1,
                transactionValue: nonZeroValue,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 103, calldata2, '0xdead', nonZeroValue)
            ).rejects.toThrow(EntityNotFound);
        });

        it('should be value-sensitive even when calldata is 0x0', async () => {
            const allowance: NewWalletTransactionAllowance = {
                userId: testUser.id,
                walletAddress: walletA,
                toAddress: contract1,
                transactionNonce: 104,
                transactionCalldata: '0x0',
                transactionValue: 0n,
                activeUntil: new Date(Date.now() + 60_000)
            };
            await repository.createOrUpdate(allowance);

            await expect(
                repository.updateTransactionHash(testUser.id, walletA, 104, '0x0', '0xdead', nonZeroValue)
            ).rejects.toThrow(EntityNotFound);
        });
    });
});

function randomAddress(): Address {
    const randomHex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return getAddress(`0x${randomHex}`);
}
