import { type ChainAddress, type ChainNode, chainAddressListIncludes } from '@repo/api-kit';
import type { Repositories } from '../db';
import type { InsertTenantUser, TenantUser } from '../repositories/tenants-repository';
import { InvalidInputError, WalletLimitExceededError } from '../utils/error-types';
import type { WalletAssociationGuard } from './wallet-association-guard';

type WalletAddresses = TenantUser['walletAddresses'];

export class TenantsService {
    constructor(
        private readonly repos: Repositories,
        private readonly chain: Pick<ChainNode, 'accountIsUnused'>,
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
        const newWallets = rawWallets.filter((w) => !chainAddressListIncludes(existingWallets, w));
        if (existingWallets.length + newWallets.length > this.maxWalletsPerUser) {
            throw new WalletLimitExceededError(this.maxWalletsPerUser);
        }

        await this.validateNewWalletAddresses(newWallets);
        return this.repos.tenants.addWalletsToUser(tenantId, userId, walletsToAdd);
    }

    private async validateNewWalletAddresses(addresses: ChainAddress[]): Promise<void> {
        this.walletAssociationGuard(addresses);
        await Promise.all(
            addresses.map(async (address) => {
                const [walletAlreadyTaken, accountIsUnused] = await Promise.all([
                    this.repos.users.walletExistInSystem(address),
                    this.chain.accountIsUnused(address)
                ]);

                if (walletAlreadyTaken || !accountIsUnused) {
                    throw new InvalidInputError(`Address ${address} cannot be added`);
                }
            })
        );
    }
}
