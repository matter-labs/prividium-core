import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyServer } from '../build-app';
import { rpcRoutes } from './rpc-routes';

const apps: FastifyServer[] = [];

function buildPreset(walletRpcEnabled: boolean): FastifyServer {
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
        policyEnabled: false
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
