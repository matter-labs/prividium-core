import { type RpcObserverFactory, rpcActorTypeSchema } from '@repo/api-kit';
import type { FastifyRequest } from 'fastify';
import type { Address } from 'viem';
import z from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { SERVICE_NAME } from '../middleware/audit-context';
import type { SessionsAuthValidator } from '../middleware/sessions-auth';
import { ContractDeploymentContext } from '../rpc/contract-deployment-context';
import { UnauthorizedRpcError } from '../rpc/errors';
import { rpcRequestSchema } from '../rpc/json-rpc';
import type { DispatcherConfig } from '../rpc/methods/dispatchers';
import { serviceHandlers } from '../rpc/methods/service-rpc-method-list';
import { walletHandlers } from '../rpc/methods/wallet-rpc-method-list';
import { RpcAuthorizer, WalletAuthorizer } from '../rpc/permissions';
import { ServiceAuthorizer } from '../rpc/permissions/service-authorizer';
import { RpcCallHandler, type ServiceContext, type WalletContext } from '../rpc/rpc-service';
import { TargetRpc } from '../rpc/target-rpc';
import type { MethodAuthorizer } from '../services/authorization-service';
import type { EventPermissionVerifier } from '../services/event-permission-verifier';
import type { TransactionClassifier } from '../services/transaction-classifier';
import { actorLogContext } from '../utils/actor-log-context';
import type { TargetChainType } from '../utils/target-chain';
import { regularRpcRoutes } from './regular-rpc-routes';
import { rpcTransport } from './rpc-transport';

type RpcRoutesOptions = {
    targetRpcUrl: string;
    targetChainType: TargetChainType;
    methodAuthService: MethodAuthorizer;
    sessionAuthValidator: SessionsAuthValidator;
    eventVerifier: EventPermissionVerifier;
    bundlerEnabled: boolean;
    bundlerRpcUrl?: string;
    dispatcherConfig: DispatcherConfig;
    transactionClassifier: TransactionClassifier;
    walletRpcEnabled: boolean;
    publicCodeAddresses: Address[];
    disclosureMethodsEnabled: boolean;
    policyEnabled: boolean;
    rpcObserverFor?: RpcObserverFactory;
};

type ServiceRpcRoutesOptions = Pick<RpcRoutesOptions, 'sessionAuthValidator' | 'targetRpcUrl' | 'targetChainType'>;
type WalletRpcRoutesOptions = Pick<
    RpcRoutesOptions,
    'methodAuthService' | 'targetRpcUrl' | 'targetChainType' | 'transactionClassifier' | 'rpcObserverFor'
>;

const tokenParamSchema = z.object({
    token: z.string()
});

function correlationContext(request: FastifyRequest) {
    return {
        ip: request.ip ?? null,
        requestId: request.requestId ?? null,
        traceId: request.traceId ?? null
    };
}

export function rpcRoutes(app: FastifyServer, options: RpcRoutesOptions): void {
    app.register(regularRpcRoutes, {
        preHandler: options.sessionAuthValidator.buildSyncHook({
            targets: [
                { type: 'user', requiredRoles: [] },
                { type: 'tenant' },
                { type: 'm2m_app' },
                { type: 'anonymous' }
            ]
        }),
        buildContext: (request) => {
            const actor = actorLogContext(request);
            const actorType = rpcActorTypeSchema.safeParse(actor.actorType);
            const targetRpc = new TargetRpc(options.targetRpcUrl, options.targetChainType);
            return {
                targetRpc,
                bundlerRpc: options.bundlerEnabled
                    ? new TargetRpc(options.bundlerRpcUrl!, options.targetChainType)
                    : null,
                authorizer: new RpcAuthorizer(
                    request.auth,
                    options.methodAuthService,
                    request.repos,
                    options.eventVerifier,
                    targetRpc,
                    request.log.child({ role: 'rpc', actor }),
                    request.requestId
                ),
                rpcObserver: options.rpcObserverFor?.({
                    origin: 'rpc',
                    actorType: actorType.success ? actorType.data : 'anonymous',
                    actorId: actor.actorId,
                    organizationId: request.auth?.type === 'user' ? request.auth.currentUser().organizationId : null,
                    ...correlationContext(request)
                }),
                dispatcherConfig: options.dispatcherConfig,
                policyEnabled: options.policyEnabled,
                deployment: new ContractDeploymentContext(request.repos, () => ({
                    requestId: request.requestId,
                    traceId: request.traceId,
                    operation: 'POST /rpc',
                    actorId: request.auth.actorId(),
                    actorType: request.auth.targetType,
                    authSubject: request.auth.isApiKeyAuth ? request.auth.currentApiKeyId() : request.auth.tokenHash,
                    serviceName: SERVICE_NAME,
                    method: 'POST',
                    url: '/rpc',
                    ip: request.ip ?? null,
                    userAgent: request.headers['user-agent'] ?? null
                }))
            };
        },
        publicCodeAddresses: options.publicCodeAddresses,
        disclosureMethodsEnabled: options.disclosureMethodsEnabled
    });

    app.register(serviceRpcRoutes, {
        prefix: '/service',
        sessionAuthValidator: options.sessionAuthValidator,
        targetRpcUrl: options.targetRpcUrl,
        targetChainType: options.targetChainType
    });

    if (options.walletRpcEnabled) {
        app.register(walletRpcRoutes, {
            prefix: '/wallet',
            methodAuthService: options.methodAuthService,
            targetRpcUrl: options.targetRpcUrl,
            targetChainType: options.targetChainType,
            transactionClassifier: options.transactionClassifier,
            rpcObserverFor: options.rpcObserverFor
        });
    }
}

export function serviceRpcRoutes(app: FastifyServer, options: ServiceRpcRoutesOptions): void {
    app.register(rpcTransport, {
        path: '/',
        role: 'service-rpc',
        preHandler: [
            options.sessionAuthValidator.buildSyncHook({
                targets: [{ type: 'service' }]
            })
        ],
        cors: false,
        execute: async (request) => {
            const handler = new RpcCallHandler<ServiceContext>(serviceHandlers, {
                targetRpc: new TargetRpc(options.targetRpcUrl, options.targetChainType),
                logger: request.log.child({ role: 'service-rpc', actor: actorLogContext(request) }),
                serviceAuthorizer: new ServiceAuthorizer(request.auth),
                bundlerRpc: null,
                deployment: null
            });
            return handler.handle(request.body);
        }
    });
}

export function walletRpcRoutes(app: FastifyServer, options: WalletRpcRoutesOptions): void {
    app.register(rpcTransport, {
        path: '/:token',
        role: 'wallet-rpc',
        preHandler: [],
        cors: {
            origin: '*',
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        },
        schema: {
            params: tokenParamSchema,
            body: rpcRequestSchema
        },
        execute: async (request) => {
            const { token } = request.params as z.infer<typeof tokenParamSchema>;
            const user = await request.repos.users.getByWalletToken(token);
            if (!user) throw new UnauthorizedRpcError('Invalid wallet RPC token');

            const handler = new RpcCallHandler<WalletContext>(walletHandlers, {
                targetRpc: new TargetRpc(options.targetRpcUrl, options.targetChainType),
                logger: request.log.child({
                    role: 'wallet-rpc',
                    actor: {
                        actorType: 'user',
                        actorId: user.id,
                        traceId: request.traceId ?? null,
                        requestId: request.requestId ?? null
                    }
                }),
                rpcObserver: options.rpcObserverFor?.({
                    origin: 'rpc_wallet',
                    actorType: 'user',
                    actorId: user.id,
                    organizationId: user.organizationId,
                    ...correlationContext(request)
                }),
                walletAuthorizer: new WalletAuthorizer(
                    user,
                    request.repos,
                    options.methodAuthService,
                    options.transactionClassifier,
                    request.requestId
                ),
                bundlerRpc: null,
                deployment: new ContractDeploymentContext(request.repos, () => ({
                    requestId: request.requestId,
                    traceId: request.traceId,
                    operation: 'POST /rpc/wallet/:token',
                    actorId: user.id,
                    actorType: 'user',
                    authSubject: 'wallet-token',
                    serviceName: SERVICE_NAME,
                    method: 'POST',
                    url: '/rpc/wallet/:token',
                    ip: request.ip ?? null,
                    userAgent: request.headers['user-agent'] ?? null
                }))
            });
            const response = await handler.handle(request.body);

            const method = rpcRequestSchema.safeParse(request.body).data?.method;
            if (method) request.log.debug({ method, response }, 'Wallet RPC response');
            return response;
        }
    });
}
