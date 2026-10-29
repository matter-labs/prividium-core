import type { preHandlerHookHandler } from 'fastify';
import type { Address } from 'viem';
import type { FastifyServer } from '#build-app';
import { type AuthorizedRpcContext, RpcCallHandler } from '#rpc/rpc-service';
import { actorLogContext } from '#utils/actor-log-context';
import { isWatchdog } from '#utils/watchdog';
import { rpcMetrics } from './rpc-metrics';
import { type RpcTransportRequest, rpcTransport } from './rpc-transport';

export type RegularRpcContext = Pick<AuthorizedRpcContext, 'targetRpc' | 'authorizer'> &
    Partial<Omit<AuthorizedRpcContext, 'logger' | 'targetRpc' | 'authorizer'>>;

export type RegularRpcRoutesOptions = {
    preHandler: preHandlerHookHandler | [preHandlerHookHandler, ...preHandlerHookHandler[]];
    buildContext: (request: RpcTransportRequest) => RegularRpcContext | Promise<RegularRpcContext>;
    publicCodeAddresses: Address[];
    disclosureMethodsEnabled: boolean;
};

export function regularRpcRoutes(app: FastifyServer, options: RegularRpcRoutesOptions): void {
    rpcMetrics(app);
    app.register(rpcTransport, {
        path: '/',
        role: 'rpc',
        preHandler: options.preHandler,
        allowApplicationSession: true,
        allowRpcSession: true,
        cors: {
            origin: '*',
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        },
        execute: async (request) => {
            const supplied = await options.buildContext(request);
            // An optional capability the application leaves out must read as absent, not as a
            // present-but-undefined value the handlers' guards would let through.
            const context: AuthorizedRpcContext = {
                ...supplied,
                bundlerRpc: supplied.bundlerRpc ?? null,
                deployment: supplied.deployment ?? null,
                policyEnabled: supplied.policyEnabled ?? false,
                logger: request.log.child({ role: 'rpc', actor: actorLogContext(request) })
            };
            return (await rpcCallHandlerFor(request, context, options)).handle(request.body);
        }
    });
}

async function rpcCallHandlerFor(
    request: RpcTransportRequest,
    context: AuthorizedRpcContext,
    options: RegularRpcRoutesOptions
): Promise<RpcCallHandler<AuthorizedRpcContext>> {
    if (request.auth?.type === 'user' && isWatchdog(request.auth.currentUser())) {
        return RpcCallHandler.forWatchdog(context, options.publicCodeAddresses);
    }
    if (await context.authorizer.hasFullSequencerAccess()) {
        return RpcCallHandler.forFullAccess(context, options.disclosureMethodsEnabled);
    }
    return RpcCallHandler.forRegularAccess(context, options.publicCodeAddresses, options.disclosureMethodsEnabled);
}
