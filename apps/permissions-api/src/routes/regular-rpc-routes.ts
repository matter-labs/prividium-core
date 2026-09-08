import type { preHandlerHookHandler } from 'fastify';
import type { Address } from 'viem';
import type { FastifyServer } from '../build-app';
import { type AuthorizedRpcContext, RpcCallHandler } from '../rpc/rpc-service';
import { actorLogContext } from '../utils/actor-log-context';
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
            const handler = (await context.authorizer.hasFullSequencerAccess())
                ? RpcCallHandler.forFullAccess(context, options.disclosureMethodsEnabled)
                : RpcCallHandler.forRegularAccess(
                      context,
                      options.publicCodeAddresses,
                      options.disclosureMethodsEnabled
                  );
            return handler.handle(request.body);
        }
    });
}
