import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyServer } from '../build-app';
import type { Authorizer } from '../rpc/permissions';
import type { ExternalRpc } from '../rpc/target-rpc';
import { metricsServer } from '../utils/metrics';
import { regularRpcRoutes } from './regular-rpc-routes';
import { serviceRpcRoutes } from './rpc-routes';

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

async function reportedFor(role: string): Promise<number> {
    const metric = await metricsServer.register.getSingleMetric('json_rpc_requests_total')?.get();
    return (metric?.values ?? [])
        .filter((value) => value.labels.role === role)
        .reduce((total, value) => total + value.value, 0);
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

    it('leaves the service RPC surface unreported, as the preset always has', async () => {
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

        expect(reported).toBe(0);
    });
});
