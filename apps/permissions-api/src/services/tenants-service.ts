import type { Address } from 'viem';
import type { Repositories } from '../db';
import type { InsertTenantUser, TenantUser } from '../repositories/tenants-repository';
import type { ExternalRpc } from '../rpc/target-rpc';
import { InvalidInputError, WalletLimitExceededError } from '../utils/error-types';
import { hexListIncludes } from '../utils/hex';
import type { WalletAssociationGuard } from './wallet-association-guard';

type WalletAddresses = TenantUser['walletAddresses'];

export class TenantsService {
    constructor(
        private readonly repos: Repositories,
        private readonly rpc: ExternalRpc,
        private readonly walletAssociationGuard: WalletAssociationGuard,
        private readonly maxWalletsPerUser: number
    ) {}

    async createUser(tenantId: string, userData: InsertTenantUser): Promise<TenantUser> {
        if (userData.walletAddresses.length > this.maxWalletsPerUser) {
            throw new WalletLimitExceededError(this.maxWalletsPerUser);
        }
        await this.validateNewWalletAddresses(userData.walletAddresses.map((w) => w.walletAddress));
        return this.repos.tenants.createUser(tenantId, userData);
    }

    async addWalletsToUser(tenantId: string, userId: string, walletsToAdd: WalletAddresses): Promise<TenantUser> {
        const rawWallets = walletsToAdd.map((w) => w.walletAddress);
        if (rawWallets.length !== new Set(rawWallets.map((w) => w.toLowerCase())).size) {
            throw new InvalidInputError('Cannot add repeated wallets');
        }

        const existingUser = await this.repos.users.findById(userId);
        const existingWallets = existingUser?.wallets.map((w) => w.walletAddress) ?? [];
        const newWallets = rawWallets.filter((w) => !hexListIncludes(existingWallets, w));
        if (existingWallets.length + newWallets.length > this.maxWalletsPerUser) {
            throw new WalletLimitExceededError(this.maxWalletsPerUser);
        }

        await this.validateNewWalletAddresses(newWallets);
        return this.repos.tenants.addWalletsToUser(tenantId, userId, walletsToAdd);
    }

    // Ensures each wallet is unused (not already registered), has never sent a transaction (nonce=0),
    // and is not a smart contract — only fresh EOAs can be added.
    private async validateNewWalletAddresses(addresses: Address[]): Promise<void> {
        this.walletAssociationGuard(addresses);
        await Promise.all(
            addresses.map(async (address) => {
                const [walletAlreadyTaken, nonceIsNotZero, isContract] = await Promise.all([
                    this.repos.users.walletExistInSystem(address),
                    this.rpc.nonceFor(address).then((nonce) => nonce !== 0n),
                    this.rpc.isContract(address)
                ]);

                if (walletAlreadyTaken || nonceIsNotZero || isContract) {
                    throw new InvalidInputError(`Address ${address} cannot be added`);
                }
            })
        );
    }
}
