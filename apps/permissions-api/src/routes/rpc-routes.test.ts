import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyServer } from '../build-app';
import { INTERNAL_RPC_ERROR, METHOD_NOT_FOUND_ERROR_CODE } from '../rpc/constants';
import { type Authorizer, type AuthorizerFactory, RpcAuthorizer } from '../rpc/permissions';
import { rpcRoutes } from './rpc-routes';

const apps: FastifyServer[] = [];

function buildPreset(walletRpcEnabled: boolean, authorizerFor?: AuthorizerFactory): FastifyServer {
    const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    apps.push(app);

    app.register(rpcRoutes, {
        prefix: '/rpc',
        targetRpcUrl: 'http://127.0.0.1:1',
        targetChainType: 'zksync-os',
        methodAuthService: {} as never,
        sessionAuthValidator: { buildSyncHook: () => async () => {} } as never,
        eventVerifier: {} as never,
        bundlerEnabled: false,
        dispatcherConfig: {} as never,
        transactionClassifier: {} as never,
        walletRpcEnabled,
        publicCodeAddresses: [],
        disclosureMethodsEnabled: false,
        policyEnabled: false,
        ...(authorizerFor === undefined ? {} : { authorizerFor })
    });
    return app;
}

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('rpcRoutes preset', () => {
    it('mounts every upstream RPC surface at its established path', async () => {
        const app = buildPreset(true);
        await app.ready();

        expect(app.hasRoute({ method: 'POST', url: '/rpc' })).toBe(true);
        expect(app.hasRoute({ method: 'POST', url: '/rpc/service' })).toBe(true);
        expect(app.hasRoute({ method: 'POST', url: '/rpc/wallet/:token' })).toBe(true);
    });

    it('drops the wallet surface when wallet RPC is off', async () => {
        const app = buildPreset(false);
        await app.ready();

        expect(app.hasRoute({ method: 'POST', url: '/rpc' })).toBe(true);
        expect(app.hasRoute({ method: 'POST', url: '/rpc/service' })).toBe(true);
        expect(app.hasRoute({ method: 'POST', url: '/rpc/wallet/:token' })).toBe(false);
    });
});

describe('rpcRoutes authorizer', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Refused locally, after the route has asked the authorizer which handler set applies.
    const callUnknownMethod = (app: FastifyServer) =>
        app.inject({
            method: 'POST',
            url: '/rpc',
            payload: { jsonrpc: '2.0', id: 1, method: 'unknown_method', params: [] }
        });

    it('decides with the core authorizer when no feature supplies one', async () => {
        const core = vi.spyOn(RpcAuthorizer.prototype, 'hasFullSequencerAccess').mockResolvedValue(false);

        await callUnknownMethod(buildPreset(false));

        expect(core).toHaveBeenCalledOnce();
    });

    it('decides with the supplied authorizer, which is handed the core one', async () => {
        const core = vi.spyOn(RpcAuthorizer.prototype, 'hasFullSequencerAccess');
        const hasFullSequencerAccess = vi.fn().mockResolvedValue(false);
        const authorizerFor = vi.fn<AuthorizerFactory>(() => ({ hasFullSequencerAccess }) as unknown as Authorizer);

        await callUnknownMethod(buildPreset(false, authorizerFor));

        expect(hasFullSequencerAccess).toHaveBeenCalledOnce();
        expect(authorizerFor).toHaveBeenCalledOnce();
        expect(authorizerFor.mock.calls[0]?.[1]).toBeInstanceOf(RpcAuthorizer);
        expect(core).not.toHaveBeenCalled();
    });

    it('answers an internal error without reaching the node when the supplied factory throws', async () => {
        const upstream = vi.spyOn(globalThis, 'fetch');
        const authorizerFor = vi.fn<AuthorizerFactory>(() => {
            throw new Error('feature authorizer unavailable');
        });

        const response = await buildPreset(false, authorizerFor).inject({
            method: 'POST',
            url: '/rpc',
            payload: { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }
        });

        expect(authorizerFor).toHaveBeenCalledOnce();
        expect(response.json()).toMatchObject({ id: 1, error: { code: INTERNAL_RPC_ERROR } });
        expect(upstream).not.toHaveBeenCalled();
    });

    // The wallet surface authorizes against a token's allowances, which `Authorizer` does not model.
    it('leaves the wallet surface on its own authorizer', async () => {
        const authorizerFor = vi.fn<AuthorizerFactory>();
        const app = buildPreset(true, authorizerFor);
        app.addHook('onRequest', async (request) => {
            request.repos = {
                users: { getByWalletToken: vi.fn().mockResolvedValue({ id: 'u1', organizationId: null }) }
            } as never;
        });

        const response = await app.inject({
            method: 'POST',
            url: '/rpc/wallet/token',
            payload: { jsonrpc: '2.0', id: 1, method: 'unknown_method', params: [] }
        });

        expect(response.json()).toMatchObject({ id: 1, error: { code: METHOD_NOT_FOUND_ERROR_CODE } });
        expect(authorizerFor).not.toHaveBeenCalled();
    });
});
