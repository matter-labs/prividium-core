import { AUDIT_ACTIONS } from '@repo/access-control';
import { keccak256, parseTransaction, type TransactionSerialized } from 'viem';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { createAuditContextMiddleware } from '../middleware/audit-context';
import type { UserWithRoles } from '../repositories/users-repository';
import { WalletAuthorizer } from '../rpc/permissions';
import { type AuthorizationService, methodAuthorizationSchema } from '../services/authorization-service';
import type { TransactionClassifier } from '../services/transaction-classifier';
import { EntityNotFound, ForbiddenError } from '../utils/error-types';
import { areHexEqual } from '../utils/hex';
import { recoverTransactionAddressNative } from '../utils/recover-tx-address-native';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { hexSchema } from '../utils/schemas/hex-schema';
import { userHasWallet } from '../utils/user-wallets';
import { UpdateTransactionHashRequestSchema, UpdateTransactionHashResponseSchema } from './schemas/wallets';

type Deps = {
    authorizationService: AuthorizationService;
    transactionClassifier: TransactionClassifier;
    auditContextMiddleware: ReturnType<typeof createAuditContextMiddleware>;
};

declare module 'fastify' {
    interface FastifyRequest {
        user: UserWithRoles;
    }
}

export function walletActionsRoutes(
    fastify: FastifyServer,
    { authorizationService, transactionClassifier, auditContextMiddleware }: Deps
) {
    fastify.addHook('onRequest', async (req, _reply) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            throw new ForbiddenError();
        }

        const [tokenType, token] = authHeader.split(' ');

        if (tokenType?.toLowerCase() !== 'bearer') {
            throw new ForbiddenError();
        }

        if (!token) {
            throw new ForbiddenError();
        }

        const user = await req.repos.users.getByWalletToken(token);

        if (user === undefined) {
            throw new ForbiddenError();
        }

        req.user = user;
    });

    fastify.get(
        '/allowance-tx-hash',
        {
            schema: {
                description: 'Returns tx hash if it was already registered',
                tags: ['wallet', 'allowance'],
                response: {
                    200: z.object({
                        txHash: hexSchema.nullable()
                    }),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const allowance = await req.repos.walletTransactionAllowances.latestForUser(req.user.id);

            if (!allowance) {
                throw new EntityNotFound('Allowance not found', { user: req.user.id });
            }

            return reply.send({
                txHash: allowance.transactionHash
            });
        }
    );

    fastify.post(
        '/verify-allowance',
        {
            schema: {
                description: 'Checks if the current token can perform a certain transaction',
                tags: ['wallet', 'check'],
                body: z.object({
                    nonce: z.number(),
                    from: hexSchema,
                    to: hexSchema,
                    calldata: hexSchema,
                    value: z.coerce.bigint()
                }),
                response: {
                    200: methodAuthorizationSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const walletAuthorizer = new WalletAuthorizer(
                req.user,
                req.repos,
                authorizationService,
                transactionClassifier,
                req.requestId
            );

            const authResult = await walletAuthorizer.checkTransactionAllowed(
                req.body.from,
                req.body.to,
                req.body.nonce,
                req.body.calldata,
                req.body.value
            );

            return reply.send({ authorized: authResult.authorized });
        }
    );

    fastify.post(
        '/can-check-balance',
        {
            schema: {
                description: 'Verifies current given address is the sender in the allowance',
                tags: ['wallet', 'check'],
                body: z.object({ address: hexSchema }),
                response: {
                    200: z.object({
                        authorized: z.boolean()
                    }),
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            if (!userHasWallet(req.user, req.body.address)) {
                return reply.send({ authorized: false });
            }

            const allowance = await req.repos.walletTransactionAllowances.latestForUser(req.user.id);
            if (!allowance) {
                return reply.send({ authorized: false });
            }

            const isAllowanceForUserAddress = areHexEqual(allowance.walletAddress, req.body.address);
            if (!isAllowanceForUserAddress) {
                return reply.send({ authorized: false });
            }

            return reply.send({ authorized: true });
        }
    );

    // ------------------------------------------------------------
    // State mutating routes
    // ------------------------------------------------------------
    fastify.post(
        '/update-transaction-hash',
        {
            preHandler: [
                auditContextMiddleware,
                async (req, _reply) => {
                    req.auditContext?.setActiveUser(req.user.id, req.user.organizationId);
                }
            ],
            config: { audit_action: AUDIT_ACTIONS.TRANSACTION_ALLOWANCE_UPDATE_HASH },
            schema: {
                description: 'Update the transaction hash for an allowance (no JWT required)',
                tags: ['wallet'],
                body: UpdateTransactionHashRequestSchema,
                response: {
                    200: UpdateTransactionHashResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { rawTx } = req.body;
            const tx = parseTransaction(rawTx);
            const from = await recoverTransactionAddressNative({
                serializedTransaction: rawTx as TransactionSerialized
            });
            const transactionHash = keccak256(rawTx);

            await req.repos.walletTransactionAllowances.updateTransactionHash(
                req.user.id,
                from,
                tx.nonce!,
                tx.data || '0x',
                transactionHash,
                tx.value ?? 0n
            );

            return reply.send({
                hash: transactionHash
            });
        }
    );
}
