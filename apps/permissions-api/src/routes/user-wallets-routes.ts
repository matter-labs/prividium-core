import { AUDIT_ACTIONS } from '@repo/access-control';
import type { PublicClient } from 'viem';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { userAccessControlPreHandler } from '../middleware/user-access-control';
import type { ExternalRpc } from '../rpc/target-rpc';
import { ERC1271Verifier } from '../services/erc1271-verifier';
import type { SiweChallengeService } from '../services/siwe-challenge-service';
import type { SiweService } from '../services/siwe-service';
import type { WalletAssociationGuard } from '../services/wallet-association-guard';
import { WalletAssociationService } from '../services/wallet-association-service';
import { EntityNotFound } from '../utils/error-types';
import { addressSchema } from '../utils/schemas/address';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import {
    AssociateWalletSchema,
    InitiateWalletAssociationSchema,
    SiweMessageResponseSchema,
    WalletListResponseSchema
} from './schemas/wallets';

const walletAddressParamSchema = z.object({
    walletAddress: addressSchema
});

type Deps = {
    siweChallengeService: SiweChallengeService;
    siweService: SiweService;
    rpcClient: PublicClient;
    chainRpc: ExternalRpc;
    walletAssociationGuard: WalletAssociationGuard;
    maxWalletsPerUser: number;
};

export function walletAssociationRoutes(
    server: FastifyServer,
    { rpcClient, siweChallengeService, siweService, chainRpc, walletAssociationGuard, maxWalletsPerUser }: Deps
) {
    const erc1271Verifier = new ERC1271Verifier(rpcClient, server.log.child({ role: 'ERC1271Verifier' }));

    server.post(
        '/initiate',
        {
            preHandler: userAccessControlPreHandler('wallets', 'associate'),
            schema: {
                description: 'Generate a SIWE message for wallet association',
                tags: ['wallets'],
                body: InitiateWalletAssociationSchema,
                response: {
                    200: SiweMessageResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const user = request.auth.currentUser();
            const { walletAddress, domain } = request.body;

            const walletService = new WalletAssociationService(
                request.repos,
                erc1271Verifier,
                chainRpc,
                siweChallengeService,
                siweService,
                walletAssociationGuard,
                maxWalletsPerUser
            );

            const siweData = await walletService.generateAssociationMessage(user.id, walletAddress, domain, request.ip);
            return reply.send(siweData);
        }
    );

    server.post(
        '/associate',
        {
            config: { audit_action: AUDIT_ACTIONS.WALLET_ASSOCIATE },
            preHandler: userAccessControlPreHandler('wallets', 'associate'),
            schema: {
                description: 'Associate a wallet with the current user after signature verification',
                tags: ['wallets'],
                body: AssociateWalletSchema,
                response: {
                    200: z.object({ success: z.boolean() }),
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    409: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const user = request.auth.currentUser();
            const { walletAddress, message, signature, nonceToken } = request.body;
            const walletService = new WalletAssociationService(
                request.repos,
                erc1271Verifier,
                chainRpc,
                siweChallengeService,
                siweService,
                walletAssociationGuard,
                maxWalletsPerUser
            );
            await walletService.verifyAndAssociateWallet(user.id, walletAddress, message, signature, nonceToken);
            return reply.send({ success: true });
        }
    );

    server.get(
        '/',
        {
            schema: {
                description: 'List all wallets associated with the current user',
                tags: ['wallets'],
                response: {
                    200: WalletListResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const user = request.auth.currentUser();
            return reply.send({
                wallets: user.wallets.map((w) => w.walletAddress)
            });
        }
    );

    server.delete(
        '/:walletAddress',
        {
            config: { audit_action: AUDIT_ACTIONS.WALLET_DISASSOCIATE },
            preHandler: userAccessControlPreHandler('wallets', 'associate'),
            schema: {
                description: 'Remove a wallet association from the current user',
                tags: ['wallets'],
                params: walletAddressParamSchema,
                response: {
                    204: z.void(),
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const { walletAddress } = request.params;
            const user = request.auth.currentUser();

            const hasWallet = await request.repos.users.checkUserAddress(user.id, walletAddress);
            if (!hasWallet) {
                throw new EntityNotFound('Wallet', { walletAddress });
            }

            const currentWallets = user.wallets.map((w) => w.walletAddress);
            const updatedWallets = currentWallets.filter((addr) => addr !== walletAddress);

            await request.repos.users.update(user.id, { wallets: updatedWallets });

            return reply.status(204).send();
        }
    );
}
