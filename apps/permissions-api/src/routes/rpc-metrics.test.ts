import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyServer } from '../build-app';
import { INVALID_REQUEST_ERROR_CODE } from '../rpc/constants';
import { MAX_RPC_METHOD_NAME_LENGTH } from '../rpc/json-rpc';
import type { Authorizer } from '../rpc/permissions';
import type { ExternalRpc } from '../rpc/target-rpc';
import { metricsServer } from '../utils/metrics';
import { regularRpcRoutes } from './regular-rpc-routes';
import { serviceRpcRoutes, walletRpcRoutes } from './rpc-routes';

const apps: FastifyServer[] = [];

function buildTestApp(): FastifyServer {
    const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    apps.push(app);
    return app;
}

async function requestsReported(role: string, run: () => Promise<unknown>): Promise<number> {
    const before = await reportedFor(role);
    await run();
    return (await reportedFor(role)) - before;
}

async function reportedFor(role: string, method?: string): Promise<number> {
    const metric = await metricsServer.register.getSingleMetric('json_rpc_requests_total')?.get();
    return (metric?.values ?? [])
        .filter((value) => value.labels.role === role && (method === undefined || value.labels.method === method))
        .reduce((total, value) => total + value.value, 0);
}

async function methodLabelsFor(role: string): Promise<Set<string>> {
    const metric = await metricsServer.register.getSingleMetric('json_rpc_requests_total')?.get();
    return new Set(
        (metric?.values ?? []).filter((value) => value.labels.role === role).map((value) => String(value.labels.method))
    );
}

function registerRegularRoutes(app: FastifyServer, fullSequencerAccess: boolean): void {
    const targetRpc = { chainType: 'besu', delegate: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }) };
    app.register(regularRpcRoutes, {
        prefix: '/rpc',
        preHandler: async () => {},
        buildContext: () => ({
            targetRpc: targetRpc as unknown as ExternalRpc,
            authorizer: { hasFullSequencerAccess: async () => fullSequencerAccess } as unknown as Authorizer
        }),
        publicCodeAddresses: [],
        disclosureMethodsEnabled: false
    });
}

function rpcCall(app: FastifyServer, method: string) {
    return app.inject({ method: 'POST', url: '/rpc', payload: { jsonrpc: '2.0', id: 1, method, params: [] } });
}

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('JSON-RPC metrics', () => {
    it('reports the regular RPC surface', async () => {
        const targetRpc = { chainType: 'besu', delegate: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }) };
        const app = buildTestApp();
        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: async () => {},
            buildContext: () => ({
                targetRpc: targetRpc as unknown as ExternalRpc,
                authorizer: { hasFullSequencerAccess: async () => false } as unknown as Authorizer
            }),
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });

        const reported = await requestsReported('rpc', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/rpc',
                payload: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }
            });
            expect(response.statusCode).toBe(200);
        });

        expect(reported).toBe(1);
    });

    it('reports the service RPC surface', async () => {
        const app = buildTestApp();
        app.register(serviceRpcRoutes, {
            prefix: '/service',
            sessionAuthValidator: { buildSyncHook: () => async () => {} } as never,
            targetRpcUrl: 'http://127.0.0.1:1',
            targetChainType: 'zksync-os'
        });

        const reported = await requestsReported('service-rpc', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/service',
                payload: { jsonrpc: '2.0', id: 1, method: 'not_a_method', params: [] }
            });
            expect(response.statusCode).toBe(200);
        });

        expect(reported).toBe(1);
    });

    it('reports the wallet RPC surface', async () => {
        const app = buildTestApp();
        app.addHook('onRequest', async (request) => {
            request.repos = {
                users: { getByWalletToken: async () => ({ id: 'user-1', organizationId: null }) }
            } as never;
        });
        app.register(walletRpcRoutes, {
            prefix: '/wallet',
            methodAuthService: {} as never,
            targetRpcUrl: 'http://127.0.0.1:1',
            targetChainType: 'zksync-os',
            transactionClassifier: {} as never
        });

        const reported = await requestsReported('wallet-rpc', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/wallet/some-token',
                payload: { jsonrpc: '2.0', id: 1, method: 'not_a_method', params: [] }
            });
            expect(response.statusCode).toBe(200);
        });

        expect(reported).toBe(1);
    });

    it.each([
        ['regular access', false],
        ['full sequencer access', true]
    ])('collapses unregistered method names into `unknown` under %s', async (_, fullSequencerAccess) => {
        const app = buildTestApp();
        registerRegularRoutes(app, fullSequencerAccess);
        const labelsBefore = await methodLabelsFor('rpc');
        const unknownBefore = await reportedFor('rpc', 'unknown');
        const names = Array.from({ length: 50 }, (_, i) => `made_up_${i}_${Date.now()}`);

        for (const method of names) {
            expect((await rpcCall(app, method)).statusCode).toBe(200);
        }

        const added = [...(await methodLabelsFor('rpc'))].filter((label) => !labelsBefore.has(label));
        expect(added.filter((label) => label !== 'unknown')).toEqual([]);
        expect(await reportedFor('rpc', 'unknown')).toBe(unknownBefore + names.length);
    });

    it('keeps registered method names, including forbidden ones, as their own label', async () => {
        const app = buildTestApp();
        registerRegularRoutes(app, false);
        const chainIdBefore = await reportedFor('rpc', 'eth_chainId');
        const traceCallBefore = await reportedFor('rpc', 'debug_traceCall');

        expect((await rpcCall(app, 'eth_chainId')).statusCode).toBe(200);
        expect((await rpcCall(app, 'debug_traceCall')).statusCode).toBe(200);

        expect(await reportedFor('rpc', 'eth_chainId')).toBe(chainIdBefore + 1);
        expect(await reportedFor('rpc', 'debug_traceCall')).toBe(traceCallBefore + 1);
    });

    it('rejects an oversized method name before anything is metered', async () => {
        const app = buildTestApp();
        registerRegularRoutes(app, false);

        const reported = await requestsReported('rpc', async () => {
            const response = await rpcCall(app, 'x'.repeat(MAX_RPC_METHOD_NAME_LENGTH + 1));
            expect(response.json()).toMatchObject({ error: { code: INVALID_REQUEST_ERROR_CODE } });
        });

        expect(reported).toBe(0);
    });
});
