import { AUDIT_ACTIONS } from '@repo/access-control';
import type { PublicClient, WalletClient } from 'viem';
import type { FastifyServer } from '../build-app';
import { FaucetService, type FaucetServiceConfig } from '../services/faucet-service';
import { assertNever } from '../utils/assert-never';
import { ForbiddenError, InternalServerError, RateLimitError } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { ClaimRequestSchema, ClaimSuccessSchema, FaucetStatusSchema } from './schemas/faucet';

type Deps = {
    publicClient: PublicClient;
    walletClient: WalletClient;
    config: FaucetServiceConfig;
};

export function faucetRoutes(server: FastifyServer, { publicClient, walletClient, config }: Deps) {
    server.post(
        '/claim',
        {
            config: { audit_action: AUDIT_ACTIONS.FAUCET_CLAIM },
            schema: {
                description: "Request a testnet ETH claim from the faucet to one of the caller's associated wallets",
                tags: ['faucet'],
                body: ClaimRequestSchema,
                response: {
                    200: ClaimSuccessSchema,
                    403: ErrorResponseSchema,
                    429: ErrorResponseSchema,
                    500: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const user = request.auth.currentUser();
            const walletAddress = request.body.walletAddress;

            const service = new FaucetService(
                request.repos,
                publicClient,
                walletClient,
                config,
                request.log.child({ role: 'FaucetService' })
            );
            const result = await service.claim(user, walletAddress);

            switch (result.kind) {
                case 'ok':
                    return reply.status(200).send({
                        txHash: result.txHash,
                        amountWei: result.amountWei.toString(),
                        nextEligibleAt: result.nextEligibleAt.toISOString()
                    });
                case 'cooldown':
                    throw new RateLimitError('You are on cooldown. Please try again later.', {
                        retryAfterSeconds: retryAfterSeconds(result.nextEligibleAt)
                    });
                case 'dailyCap':
                    throw new RateLimitError('Daily faucet cap reached. Please try again later.', {
                        retryAfterSeconds: retryAfterSeconds(result.capResetsAt)
                    });
                case 'walletNotAssociated':
                    throw new ForbiddenError('That wallet is not associated with your account.');
                case 'unavailable':
                    throw new InternalServerError('The faucet is temporarily unavailable. Please try again later.');
                case 'txFailed':
                    throw new InternalServerError('The claim transaction failed on-chain. Please contact support.');
                default:
                    return assertNever(result);
            }
        }
    );

    server.get(
        '/status',
        {
            schema: {
                description: 'Return the current faucet cooldown state for the authenticated user',
                tags: ['faucet'],
                response: {
                    200: FaucetStatusSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (request, reply) => {
            const user = request.auth.currentUser();

            const service = new FaucetService(
                request.repos,
                publicClient,
                walletClient,
                config,
                request.log.child({ role: 'FaucetService' })
            );
            const status = await service.getStatus(user.id);
            return reply.send({
                nextEligibleAt: status.nextEligibleAt ? status.nextEligibleAt.toISOString() : null,
                lastSuccess: status.lastSuccess
                    ? {
                          createdAt: status.lastSuccess.createdAt.toISOString(),
                          walletAddress: status.lastSuccess.walletAddress,
                          txHash: status.lastSuccess.txHash
                      }
                    : null
            });
        }
    );
}

function retryAfterSeconds(date: Date): number {
    return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}
