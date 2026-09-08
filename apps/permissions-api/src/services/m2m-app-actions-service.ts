import type { Address } from 'viem';
import type { Repositories } from '../db';
import { UserSources } from '../db/schema';
import type { TenantUser } from '../repositories/tenants-repository';
import type { User } from '../repositories/users-repository';
import type { ExternalRpc } from '../rpc/target-rpc';
import { EntityNotFound, InvalidInputError, WalletLimitExceededError } from '../utils/error-types';
import { hexListIncludes } from '../utils/hex';
import type { WalletAssociationGuard } from './wallet-association-guard';

type WalletAddresses = TenantUser['walletAddresses'];

export interface CreateOrgUserInput {
    displayName: string;
    walletAddresses: WalletAddresses;
}

type Deps = {
    repos: Repositories;
    rpc: ExternalRpc;
    walletAssociationGuard: WalletAssociationGuard;
    maxWalletsPerUser: number;
    multiOrgEnabled: boolean;
};

export class M2mAppActionsService {
    private readonly repos: Repositories;
    private readonly rpc: ExternalRpc;
    private readonly walletAssociationGuard: WalletAssociationGuard;
    private readonly maxWalletsPerUser: number;
    private readonly multiOrgEnabled: boolean;

    constructor({ repos, rpc, walletAssociationGuard, maxWalletsPerUser, multiOrgEnabled }: Deps) {
        this.repos = repos;
        this.rpc = rpc;
        this.walletAssociationGuard = walletAssociationGuard;
        this.maxWalletsPerUser = maxWalletsPerUser;
        this.multiOrgEnabled = multiOrgEnabled;
    }

    async createUser(orgId: string, userData: CreateOrgUserInput): Promise<User> {
        const org = await this.repos.organizations.getById(orgId);
        const wallets = userData.walletAddresses.map((w) => w.walletAddress);

        if (wallets.length > this.maxWalletsPerUser) {
            throw new WalletLimitExceededError(this.maxWalletsPerUser);
        }
        if (wallets.length > 0) {
            await this.validateNewWalletAddresses(wallets);
        }

        return this.repos.users.create(
            {
                source: UserSources.enum.m2m_app,
                displayName: userData.displayName,
                wallets,
                roles: org.defaultRoles.map((r) => r.id),
                organizationId: orgId
            },
            { allowZoneRoles: !this.multiOrgEnabled }
        );
    }

    async addWalletsToUser(orgId: string, userId: string, walletsToAdd: WalletAddresses): Promise<User> {
        if (walletsToAdd.length === 0) {
            throw new InvalidInputError('List of wallets to add is empty');
        }

        const user = await this.repos.users.findById(userId);
        if (!user || user.organization?.id !== orgId) {
            throw new EntityNotFound('User', { id: userId });
        }

        const existingWallets = user.wallets.map((w) => w.walletAddress);
        const requestedWallets = walletsToAdd.map((w) => w.walletAddress);
        const uniqueRequested = [...new Set(requestedWallets.map((w) => w.toLowerCase()))];
        if (uniqueRequested.length !== requestedWallets.length) {
            throw new InvalidInputError('Duplicate wallet addresses in request');
        }

        const newWallets = requestedWallets.filter((w) => !hexListIncludes(existingWallets, w));
        if (newWallets.length === 0) {
            throw new InvalidInputError('Wallets already belong to the user');
        }
        if (existingWallets.length + newWallets.length > this.maxWalletsPerUser) {
            throw new WalletLimitExceededError(this.maxWalletsPerUser);
        }

        await this.validateNewWalletAddresses(newWallets);
        return this.repos.users.update(userId, { wallets: [...existingWallets, ...newWallets] });
    }

    // Ensures each wallet is unused (not already registered), has never sent a transaction (nonce=0),
    // and is not a smart contract — only fresh EOAs can be added.
    // NOTE: this code is repeated in tenants-service, given tenants will be deprecated soon.
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
