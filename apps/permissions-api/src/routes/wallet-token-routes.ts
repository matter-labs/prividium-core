import { AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyServer } from '../build-app';
import type { AuthorizationService } from '../services/authorization-service';
import type { TransactionClassifier } from '../services/transaction-classifier';
import type { WalletTokenService } from '../services/wallet-token-service';
import { ForbiddenError, InvalidInputError } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { userHasWallet } from '../utils/user-wallets';
import {
    EnableWalletRequestSchema,
    EnableWalletResponseSchema,
    InvalidateResponseSchema,
    PersonalRpcTokenResponseSchema,
    TransactionAuthorizationRequestSchema,
    TransactionAuthorizationResponseSchema
} from './schemas/wallets';

type Deps = {
    walletTokenService: WalletTokenService;
    authorizationService: AuthorizationService;
    transactionClassifier: TransactionClassifier;
};

export function walletRoutes(
    fastify: FastifyServer,
    { walletTokenService, authorizationService, transactionClassifier }: Deps
) {
    fastify.get(
        '/personal-rpc-token',
        {
            schema: {
                description: 'Get the Per-User RPC token for the authenticated user',
                tags: ['wallet'],
                response: {
                    200: PersonalRpcTokenResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const user = req.auth.currentUser();
            const usersRepo = req.repos.users;

            let token = await usersRepo.getWalletToken(user.id);

            if (!token) {
                token = walletTokenService.generateWalletToken();
                await usersRepo.storeWalletToken(user.id, token);
            }

            return reply.send({ token });
        }
    );

    fastify.post(
        '/invalidate',
        {
            config: { audit_action: AUDIT_ACTIONS.WALLET_TOKEN_INVALIDATE },
            schema: {
                description: 'Invalidate current RPC token and generate a new one',
                tags: ['wallet'],
                response: {
                    200: InvalidateResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const user = req.auth.currentUser();

            // storing a new token invalidates the previous one
            const newWalletToken = walletTokenService.generateWalletToken();
            await req.repos.users.storeWalletToken(user.id, newWalletToken);

            return reply.send({
                newWalletToken,
                message: 'All previous wallet tokens have been invalidated'
            });
        }
    );

    fastify.post(
        '/enable',
        {
            config: { audit_action: AUDIT_ACTIONS.TRANSACTION_ALLOWANCE_CREATE },
            schema: {
                deprecated: true,
                description: 'Enable RPC for a specific transaction with calldata and nonce for 1 hour',
                tags: ['wallet'],
                body: EnableWalletRequestSchema,
                response: {
                    200: EnableWalletResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const user = req.auth.currentUser();

            if (!userHasWallet(user, req.body.walletAddress)) {
                throw new ForbiddenError('Wallet address is not associated with the user');
            }

            // complete check is performed in /wallet-actions/verify-allowance
            const authorization = await authorizationService.checkMethodAuthorizationForUser({
                fromAddress: req.body.walletAddress,
                user,
                contractAddress: req.body.contractAddress,
                calldata: req.body.calldata,
                accessTypeCheck: 'write'
            });
            if (!authorization.authorized) {
                throw new ForbiddenError('User is not authorized to perform this action');
            }

            const activeUntil = new Date();
            activeUntil.setHours(activeUntil.getHours() + 1);

            await req.repos.walletTransactionAllowances.createOrUpdate({
                userId: user.id,
                walletAddress: req.body.walletAddress,
                toAddress: req.body.contractAddress,
                transactionNonce: req.body.nonce,
                transactionCalldata: req.body.calldata,
                // value-based allowances unsupported; always 0
                transactionValue: 0n,
                activeUntil
            });

            return reply.send({
                message: 'RPC enabled for this transaction',
                activeUntil: activeUntil.toISOString()
            });
        }
    );

    fastify.post(
        '/transaction-authorization',
        {
            config: { audit_action: AUDIT_ACTIONS.TRANSACTION_ALLOWANCE_CREATE },
            schema: {
                description: 'Enable RPC for a specific transaction for 1 hour',
                tags: ['wallet'],
                body: TransactionAuthorizationRequestSchema,
                response: {
                    200: TransactionAuthorizationResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const user = req.auth.currentUser();

            if (!userHasWallet(user, req.body.walletAddress)) {
                throw new ForbiddenError('Wallet address is not associated with the user');
            }

            const calldata = req.body.calldata ?? '0x';
            const bodyValue = req.body.value ?? 0n;
            const rawToAddress = req.body.toAddress;

            const classification = await transactionClassifier.classifyTransaction(rawToAddress, calldata, bodyValue);

            if (classification.type === 'empty') {
                throw new InvalidInputError('Transaction must have calldata or value to be authorized');
            }

            let authorized = false;

            if (classification.type === 'contract-call' || classification.type === 'transfer-to-contract') {
                const authorization = await authorizationService.checkMethodAuthorizationForUser({
                    fromAddress: req.body.walletAddress,
                    user,
                    contractAddress: classification.toAddress,
                    calldata,
                    accessTypeCheck: 'write'
                });

                authorized = authorization.authorized;
            }

            // Allow transfer transactions only to EOA addresses
            if (classification.type === 'transfer-to-eoa') {
                authorized = true;
            }

            if (classification.type === 'deployment') {
                authorized = req.auth.permix().check('sequencer', 'deployment');
            }

            if (!authorized) {
                throw new ForbiddenError('User is not authorized to perform this action');
            }

            const activeUntil = new Date();
            activeUntil.setHours(activeUntil.getHours() + 1);

            await req.repos.walletTransactionAllowances.createOrUpdate({
                userId: user.id,
                walletAddress: req.body.walletAddress,
                toAddress: req.body.toAddress,
                transactionNonce: req.body.nonce,
                transactionCalldata: calldata,
                transactionValue: bodyValue,
                activeUntil
            });

            return reply.send({
                message: 'RPC enabled for this transaction',
                activeUntil: activeUntil.toISOString()
            });
        }
    );
}
