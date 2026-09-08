import type { PublicClient, WalletClient } from 'viem';
import type { FastifyServer } from '../build-app';
import { FaucetService, type FaucetServiceConfig } from '../services/faucet-service';
import { ErrorResponseSchema, PaginationQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import { AdminFaucetStatusSchema, FaucetClaimSchema } from './schemas/faucet';

type Deps = {
    publicClient: PublicClient;
    walletClient: WalletClient;
    config: FaucetServiceConfig;
};

export function adminFaucetRoutes(app: FastifyServer, { publicClient, walletClient, config }: Deps) {
    app.get(
        '/status',
        {
            schema: {
                description: 'Return faucet operator wallet balance and 24h spend',
                tags: ['admin', 'faucet'],
                response: {
                    200: AdminFaucetStatusSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const service = new FaucetService(
                req.repos,
                publicClient,
                walletClient,
                config,
                req.log.child({ role: 'FaucetService' })
            );
            const status = await service.getAdminStatus();
            return reply.send({
                operatorAddress: status.operatorAddress,
                operatorBalanceWei: status.operatorBalanceWei?.toString() ?? null,
                last24hSuccessWei: status.last24hSuccessWei.toString(),
                config: {
                    claimAmountWei: status.config.claimAmountWei.toString(),
                    cooldownSeconds: status.config.cooldownSeconds,
                    maxDailySpendWei: status.config.maxDailySpendWei.toString()
                }
            });
        }
    );

    app.get(
        '/claims',
        {
            schema: {
                description: 'Return a paginated list of recent faucet claims',
                tags: ['admin', 'faucet'],
                querystring: PaginationQuerySchema({ limit: { max: 1000 } }),
                response: {
                    200: paginatedResult(FaucetClaimSchema),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const service = new FaucetService(
                req.repos,
                publicClient,
                walletClient,
                config,
                req.log.child({ role: 'FaucetService' })
            );
            const result = await service.listClaims(req.query);
            return reply.send({
                items: result.items.map((item) => ({
                    id: item.id,
                    userId: item.userId,
                    walletAddress: item.walletAddress,
                    // uint256Column infers bigint | null regardless of .notNull()
                    amountWei: (item.amountWei ?? 0n).toString(),
                    txHash: item.txHash,
                    status: item.status,
                    createdAt: item.createdAt.toISOString(),
                    updatedAt: item.updatedAt.toISOString()
                })),
                pagination: result.pagination
            });
        }
    );
}
