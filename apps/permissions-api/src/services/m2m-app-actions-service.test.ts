import { pad } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { TestExternalRpc } from '../../test/rpc/test-external-rpc';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { OrganizationsRepository } from '../repositories/organizations-repository';
import { RolesRepository } from '../repositories/roles-repository';
import { UsersRepository } from '../repositories/users-repository';
import { EntityNotFound, InvalidInputError, WalletLimitExceededError } from '../utils/error-types';
import { M2mAppActionsService } from './m2m-app-actions-service';
import { createWalletAssociationGuard } from './wallet-association-guard';

// Strict guard (empty allowlist) — fixtures use synthesized addresses that don't
// collide with the well-known dev list, so it passes through for those.
const strictWalletGuard = createWalletAssociationGuard([]);
const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const MAX_WALLETS_PER_USER = 3;

describe('M2mAppActionsService', () => {
    let service: M2mAppActionsService;
    let orgsRepo: OrganizationsRepository;
    let usersRepo: UsersRepository;
    let rolesRepo: RolesRepository;
    let externalRpc: TestExternalRpc;

    beforeEach<Fixture>(async ({ db }) => {
        orgsRepo = new OrganizationsRepository(db);
        usersRepo = new UsersRepository(db);
        rolesRepo = new RolesRepository(db);
        externalRpc = new TestExternalRpc();
        service = new M2mAppActionsService({
            repos: new Repositories(db),
            rpc: externalRpc,
            walletAssociationGuard: strictWalletGuard,
            maxWalletsPerUser: MAX_WALLETS_PER_USER,
            multiOrgEnabled: false
        });
    });

    describe('createUser', () => {
        it('creates user with no wallets and org default roles', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const role = await rolesRepo.create(
                { roleName: 'member', systemPermissions: [] },
                { organizationId: org.id }
            );
            await orgsRepo.update(org.id, { name: org.name, defaultRoles: [{ id: role.id }] });

            const user = await service.createUser(org.id, {
                displayName: 'Alice',
                walletAddresses: []
            });

            expect(user.displayName).toBe('Alice');
            expect(user.source).toBe('m2m_app');
            expect(user.roles.map((r) => r.roleName)).toEqual([role.roleName]);
            expect(user.wallets).toHaveLength(0);
            expect(user.organization?.id).toBe(org.id);
        });

        it('creates user with valid wallets', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x01', { size: 20 });

            const user = await service.createUser(org.id, {
                displayName: 'Bob',
                walletAddresses: [{ walletAddress: wallet }]
            });

            expect(user.wallets).toHaveLength(1);
            expect(user.wallets[0]!.walletAddress).toBe(wallet);
        });

        it('throws EntityNotFound when org does not exist', async () => {
            await expect(
                service.createUser('non-existent-id', {
                    displayName: 'Alice',
                    walletAddresses: []
                })
            ).rejects.toThrow(EntityNotFound);
        });

        it('rejects if wallet already exists in system', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x01', { size: 20 });
            await usersRepo.create({ displayName: 'Existing', wallets: [wallet], source: 'adminPanel' });

            await expect(
                service.createUser(org.id, {
                    displayName: 'New',
                    walletAddresses: [{ walletAddress: wallet }]
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects if wallet has non-zero nonce', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x02', { size: 20 });
            externalRpc.setNonceFor(wallet, 5n);

            await expect(
                service.createUser(org.id, {
                    displayName: 'New',
                    walletAddresses: [{ walletAddress: wallet }]
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects if wallet is a contract', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x03', { size: 20 });
            externalRpc.registerCodeFor(wallet, '0x01010101');

            await expect(
                service.createUser(org.id, {
                    displayName: 'New',
                    walletAddresses: [{ walletAddress: wallet }]
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('rejects when wallet count exceeds the per-user limit', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const walletAddresses = Array.from({ length: MAX_WALLETS_PER_USER + 1 }, (_, i) => ({
                walletAddress: pad(`0x0${i + 1}`, { size: 20 })
            }));

            await expect(service.createUser(org.id, { displayName: 'Bob', walletAddresses })).rejects.toThrow(
                WalletLimitExceededError
            );
        });

        it('rejects a well-known dev wallet when not on the allowlist', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            await expect(
                service.createUser(org.id, {
                    displayName: 'Bob',
                    walletAddresses: [{ walletAddress: ANVIL_ACCOUNT_0 }]
                })
            ).rejects.toThrow(/private key is publicly known/);
        });

        it<Fixture>('accepts a well-known dev wallet when listed on the allowlist', async ({ db }) => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const allowingService = new M2mAppActionsService({
                repos: new Repositories(db),
                rpc: externalRpc,
                walletAssociationGuard: createWalletAssociationGuard([ANVIL_ACCOUNT_0]),
                maxWalletsPerUser: MAX_WALLETS_PER_USER,
                multiOrgEnabled: false
            });
            await expect(
                allowingService.createUser(org.id, {
                    displayName: 'Bob',
                    walletAddresses: [{ walletAddress: ANVIL_ACCOUNT_0 }]
                })
            ).resolves.toBeDefined();
        });
    });

    describe('addWalletsToUser', () => {
        it('throws InvalidInputError when wallet list is empty', async () => {
            await expect(service.addWalletsToUser('any-org', 'any-user', [])).rejects.toThrow(InvalidInputError);
        });

        it('throws EntityNotFound when user does not exist', async () => {
            const wallet = pad('0x01', { size: 20 });

            await expect(
                service.addWalletsToUser('any-org', 'non-existent-id', [{ walletAddress: wallet }])
            ).rejects.toThrow(EntityNotFound);
        });

        it('throws EntityNotFound when user belongs to a different org', async () => {
            const orgA = await orgsRepo.create({ name: 'OrgA', defaultRoles: [] });
            const orgB = await orgsRepo.create({ name: 'OrgB', defaultRoles: [] });
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [],
                source: 'm2m_app',
                organizationId: orgA.id
            });
            const wallet = pad('0x01', { size: 20 });

            await expect(service.addWalletsToUser(orgB.id, user.id, [{ walletAddress: wallet }])).rejects.toThrow(
                EntityNotFound
            );
        });

        it('throws InvalidInputError when all wallets already belong to user', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x01', { size: 20 });
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [wallet],
                source: 'm2m_app',
                organizationId: org.id
            });

            await expect(service.addWalletsToUser(org.id, user.id, [{ walletAddress: wallet }])).rejects.toThrow(
                InvalidInputError
            );
        });

        it('adds new wallets to user', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const existingWallet = pad('0x01', { size: 20 });
            const newWallet = pad('0x02', { size: 20 });
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [existingWallet],
                source: 'm2m_app',
                organizationId: org.id
            });

            const updated = await service.addWalletsToUser(org.id, user.id, [{ walletAddress: newWallet }]);

            expect(updated.wallets).toHaveLength(2);
            const addresses = updated.wallets.map((w) => w.walletAddress);
            expect(addresses).toContain(existingWallet);
            expect(addresses).toContain(newWallet);
        });

        it('adds only new wallets when some already belong to user', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const existingWallet = pad('0x01', { size: 20 });
            const newWallet = pad('0x02', { size: 20 });
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [existingWallet],
                source: 'm2m_app',
                organizationId: org.id
            });

            const updated = await service.addWalletsToUser(org.id, user.id, [
                { walletAddress: existingWallet },
                { walletAddress: newWallet }
            ]);

            expect(updated.wallets).toHaveLength(2);
        });

        it('rejects when adding wallets past the per-user limit', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const existingWallets = Array.from({ length: MAX_WALLETS_PER_USER }, (_, i) =>
                pad(`0x0${i + 1}`, { size: 20 })
            );
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: existingWallets,
                source: 'm2m_app',
                organizationId: org.id
            });

            await expect(
                service.addWalletsToUser(org.id, user.id, [{ walletAddress: pad('0x0f', { size: 20 }) }])
            ).rejects.toThrow(WalletLimitExceededError);
        });

        it('rejects if new wallet already exists in system', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x10', { size: 20 });
            await usersRepo.create({ displayName: 'Other', wallets: [wallet], source: 'adminPanel' });
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [],
                source: 'm2m_app',
                organizationId: org.id
            });

            await expect(service.addWalletsToUser(org.id, user.id, [{ walletAddress: wallet }])).rejects.toThrow(
                InvalidInputError
            );
        });

        it('rejects if new wallet has non-zero nonce', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x11', { size: 20 });
            externalRpc.setNonceFor(wallet, 10n);
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [],
                source: 'm2m_app',
                organizationId: org.id
            });

            await expect(service.addWalletsToUser(org.id, user.id, [{ walletAddress: wallet }])).rejects.toThrow(
                InvalidInputError
            );
        });

        it('rejects if new wallet is a contract', async () => {
            const org = await orgsRepo.create({ name: 'Org1', defaultRoles: [] });
            const wallet = pad('0x12', { size: 20 });
            externalRpc.registerCodeFor(wallet, '0x01010101');
            const user = await usersRepo.create({
                displayName: 'Alice',
                wallets: [],
                source: 'm2m_app',
                organizationId: org.id
            });

            await expect(service.addWalletsToUser(org.id, user.id, [{ walletAddress: wallet }])).rejects.toThrow(
                InvalidInputError
            );
        });
    });
});
