import { pad } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect } from 'vitest';
import { TestExternalRpc } from '../../test/rpc/test-external-rpc';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { type Tenant, TenantsRepository } from '../repositories/tenants-repository';
import { UsersRepository } from '../repositories/users-repository';
import { InvalidInputError, WalletLimitExceededError } from '../utils/error-types';
import { TenantsService } from './tenants-service';
import { createWalletAssociationGuard } from './wallet-association-guard';

// Strict guard (empty allowlist) — fixtures use synthesized addresses that don't
// collide with the well-known dev list, so it passes through for those.
const strictWalletGuard = createWalletAssociationGuard([]);
const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const MAX_WALLETS_PER_USER = 3;

describe('TenantsService', () => {
    let service: TenantsService;
    let repository: TenantsRepository;
    let userRepo: UsersRepository;
    let externalRpc: TestExternalRpc;

    const privateKey = generatePrivateKey();
    const address = privateKeyToAddress(privateKey);

    beforeEach<Fixture>(async ({ db }) => {
        repository = new TenantsRepository(db);
        userRepo = new UsersRepository(db);
        externalRpc = new TestExternalRpc();
        service = new TenantsService(new Repositories(db), externalRpc, strictWalletGuard, MAX_WALLETS_PER_USER);
    });

    describe('createUser', () => {
        let existingTenant: Tenant;
        beforeEach(async () => {
            existingTenant = await repository.create({ name: 'tenant01', publicKey: address, defaultRoles: [] });
        });

        it('rejects if wallet address already exists in system', async () => {
            const wallet = pad('0x01', { size: 20 });
            await userRepo.create({ displayName: 'Existing User', wallets: [wallet], source: 'adminPanel' });

            await expect(
                service.createUser(existingTenant.id, {
                    displayName: 'New User',
                    walletAddresses: [{ walletAddress: wallet }]
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects if wallet address has non-zero nonce', async () => {
            const wallet = pad('0x02', { size: 20 });
            externalRpc.setNonceFor(wallet, 5n);

            await expect(
                service.createUser(existingTenant.id, {
                    displayName: 'New User',
                    walletAddresses: [{ walletAddress: wallet }]
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects if wallet address is a contract', async () => {
            const wallet = pad('0x03', { size: 20 });
            externalRpc.registerCodeFor(wallet, '0x01010101');

            await expect(
                service.createUser(existingTenant.id, {
                    displayName: 'New User',
                    walletAddresses: [{ walletAddress: wallet }]
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects when wallet count exceeds the per-user limit', async () => {
            const walletAddresses = Array.from({ length: MAX_WALLETS_PER_USER + 1 }, (_, i) => ({
                walletAddress: pad(`0x0${i + 1}`, { size: 20 })
            }));

            await expect(
                service.createUser(existingTenant.id, { displayName: 'New User', walletAddresses })
            ).rejects.toThrow(WalletLimitExceededError);
        });

        it('rejects a well-known dev wallet when not on the allowlist', async () => {
            await expect(
                service.createUser(existingTenant.id, {
                    displayName: 'New User',
                    walletAddresses: [{ walletAddress: ANVIL_ACCOUNT_0 }]
                })
            ).rejects.toThrow(/private key is publicly known/);
        });

        it<Fixture>('accepts a well-known dev wallet when listed on the allowlist', async ({ db }) => {
            const allowingService = new TenantsService(
                new Repositories(db),
                externalRpc,
                createWalletAssociationGuard([ANVIL_ACCOUNT_0]),
                MAX_WALLETS_PER_USER
            );
            await expect(
                allowingService.createUser(existingTenant.id, {
                    displayName: 'New User',
                    walletAddresses: [{ walletAddress: ANVIL_ACCOUNT_0 }]
                })
            ).resolves.toBeDefined();
        });
    });

    describe('addWalletsToUser', () => {
        let existingTenant: Tenant;
        beforeEach(async () => {
            existingTenant = await repository.create({ name: 'tenant01', publicKey: address, defaultRoles: [] });
        });

        it('rejects if wallet address already exists in system (even after removal)', async () => {
            const wallet = pad('0x01', { size: 20 });
            const user = await userRepo.create({
                displayName: 'Existing User',
                wallets: [wallet],
                source: 'adminPanel'
            });
            await userRepo.update(user.id, { ...user, wallets: [], roles: [] });

            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });

            await expect(
                service.addWalletsToUser(existingTenant.id, created.id, [{ walletAddress: wallet }])
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects when adding wallets past the per-user limit', async () => {
            const existingWallets = Array.from({ length: MAX_WALLETS_PER_USER }, (_, i) =>
                pad(`0x0${i + 1}`, { size: 20 })
            );
            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: existingWallets.map((walletAddress) => ({ walletAddress }))
            });

            await expect(
                service.addWalletsToUser(existingTenant.id, created.id, [{ walletAddress: pad('0x0f', { size: 20 }) }])
            ).rejects.toThrow(WalletLimitExceededError);
        });

        it('rejects if wallet address has non-zero nonce', async () => {
            const wallet = pad('0x01', { size: 20 });
            externalRpc.setNonceFor(wallet, 10n);

            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });

            await expect(
                service.addWalletsToUser(existingTenant.id, created.id, [{ walletAddress: wallet }])
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects if wallet address is a contract', async () => {
            const wallet = pad('0x01', { size: 20 });
            externalRpc.registerCodeFor(wallet, '0x01010101');

            const created = await repository.createUser(existingTenant.id, {
                displayName: 'Test User',
                walletAddresses: []
            });

            await expect(
                service.addWalletsToUser(existingTenant.id, created.id, [{ walletAddress: wallet }])
            ).rejects.toThrow(InvalidInputError);
        });
    });
});
