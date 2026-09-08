import { and, eq } from 'drizzle-orm';
import { isNull } from 'drizzle-orm/sql/expressions/conditions';
import { type Address, type Hex, verifyMessage } from 'viem';
import type { Repositories } from '../db';
import { walletsTable } from '../db/schema';
import type { ExternalRpc } from '../rpc/target-rpc';
import {
    EntityAlreadyExistsError,
    ForbiddenError,
    InvalidInputError,
    WalletLimitExceededError
} from '../utils/error-types';
import { userHasWallet } from '../utils/user-wallets';
import type { ERC1271Verifier } from './erc1271-verifier';
import type { SiweChallengeService } from './siwe-challenge-service';
import type { SiweService } from './siwe-service';
import type { WalletAssociationGuard } from './wallet-association-guard';

type SiweMessageData = {
    message: string;
    nonce: string;
    nonceToken: string;
};

export class WalletAssociationService {
    private erc1271Verifier: ERC1271Verifier;
    private chainRpc: ExternalRpc;
    private siweChallengeService: SiweChallengeService;
    private siweService: SiweService;
    private repos: Repositories;
    private walletAssociationGuard: WalletAssociationGuard;
    private maxWalletsPerUser: number;

    constructor(
        repos: Repositories,
        erc1271Verifier: ERC1271Verifier,
        chainRpc: ExternalRpc,
        siweChallengeService: SiweChallengeService,
        siweService: SiweService,
        walletAssociationGuard: WalletAssociationGuard,
        maxWalletsPerUser: number
    ) {
        this.repos = repos;
        this.erc1271Verifier = erc1271Verifier;
        this.chainRpc = chainRpc;
        this.siweChallengeService = siweChallengeService;
        this.siweService = siweService;
        this.walletAssociationGuard = walletAssociationGuard;
        this.maxWalletsPerUser = maxWalletsPerUser;
    }

    async generateAssociationMessage(
        userId: string,
        walletAddress: Address,
        domain: string,
        clientIp?: string
    ): Promise<SiweMessageData> {
        this.walletAssociationGuard([walletAddress]);
        const existingAssociation = await this.repos.db.query.walletsTable.findFirst({
            where: and(eq(walletsTable.walletAddress, walletAddress), isNull(walletsTable.deletedAt))
        });
        if (existingAssociation) {
            const isAssociatedToCurrentUser = existingAssociation.userId === userId;
            if (isAssociatedToCurrentUser) {
                throw new EntityAlreadyExistsError('This wallet is already associated');
            }
            throw new EntityAlreadyExistsError('This wallet is already associated with another user');
        }

        const siweMessage = await this.siweChallengeService.createForWalletAssociation(
            walletAddress,
            domain,
            userId,
            clientIp
        );

        return { message: siweMessage.msg, nonce: siweMessage.nonce, nonceToken: siweMessage.nonceToken };
    }

    async verifyAndAssociateWallet(
        userId: string,
        walletAddress: Address,
        message: string,
        signature: Hex,
        nonceToken: string
    ): Promise<void> {
        this.walletAssociationGuard([walletAddress]);
        const tokenPayload = this.siweService.verifySiweChallenge({ message, nonceToken });
        if (
            tokenPayload.targetType !== 'user' ||
            tokenPayload.targetId !== userId ||
            tokenPayload.address.toLowerCase() !== walletAddress.toLowerCase()
        ) {
            throw new ForbiddenError('Failed to verify wallet');
        }

        // Check if address is a smart contract
        const isContract = await this.chainRpc.isContract(walletAddress);

        let isValid: boolean;
        if (isContract) {
            // Use ERC1271 verification for smart contracts
            isValid = await this.erc1271Verifier.verifySmartAccountSignature(
                walletAddress,
                message,
                signature,
                this.siweService.chainId
            );
        } else {
            // Use standard verification for EOA
            isValid = await verifyMessage({
                address: walletAddress,
                message,
                signature
            }).catch(() => false);
        }

        if (!isValid) {
            throw new ForbiddenError('Failed to verify wallet');
        }

        const consumed = await this.siweService.consumeSiweNonce(tokenPayload.nonce);
        if (!consumed) {
            throw new ForbiddenError('Failed to verify wallet');
        }

        // Get current user data
        const user = await this.repos.users.findById(userId);
        if (!user) {
            throw new ForbiddenError('User not found');
        }

        // Check if wallet is already associated with this user
        if (userHasWallet(user, walletAddress)) {
            throw new InvalidInputError('Wallet is already associated with your account');
        }

        if (user.wallets.length >= this.maxWalletsPerUser) {
            throw new WalletLimitExceededError(this.maxWalletsPerUser);
        }

        // Associate the wallet with the user
        const walletAddresses = user.wallets.map((w) => w.walletAddress);
        const updatedWallets = [...walletAddresses, walletAddress];

        await this.repos.users.update(userId, { wallets: updatedWallets });
    }
}
