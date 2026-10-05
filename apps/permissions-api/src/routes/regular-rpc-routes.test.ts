import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyServer } from '../build-app';
import { INVALID_REQUEST_ERROR_CODE, METHOD_NOT_FOUND_ERROR_CODE, UNAUTHORIZED_ERROR_CODE } from '../rpc/constants';
import { MAX_RPC_BATCH_SIZE } from '../rpc/json-rpc';
import type { Authorizer } from '../rpc/permissions';
import type { ExternalRpc } from '../rpc/target-rpc';
import { UnauthorizedError } from '../utils/error-types';
import { type RegularRpcContext, type RegularRpcRoutesOptions, regularRpcRoutes } from './regular-rpc-routes';

const apps: FastifyServer[] = [];

function buildTestApp(): FastifyServer {
    const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    apps.push(app);
    return app;
}

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('regularRpcRoutes', () => {
    it('serves the regular RPC surface from one application-built request context', async () => {
        const delegate = vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 7, result: '0x1092' });
        const targetRpc = {
            chainType: 'besu',
            delegate
        } as unknown as ExternalRpc;
        const hasFullSequencerAccess = vi.fn().mockResolvedValue(false);
        const authorizer = { hasFullSequencerAccess } as unknown as Authorizer;
        const authenticate = vi.fn(async () => {});
        const buildContext = vi.fn((request) => {
            expect(request.log).toBeDefined();
            return { targetRpc, authorizer };
        }) satisfies RegularRpcRoutesOptions['buildContext'];
        const app = buildTestApp();

        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: authenticate,
            buildContext,
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });

        const response = await app.inject({
            method: 'POST',
            url: '/rpc',
            payload: { jsonrpc: '2.0', id: 7, method: 'eth_chainId', params: [] }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ jsonrpc: '2.0', id: 7, result: '0x1092' });
        expect(authenticate).toHaveBeenCalledOnce();
        expect(buildContext).toHaveBeenCalledOnce();
        expect(buildContext.mock.calls[0]).toHaveLength(1);
        expect(hasFullSequencerAccess).toHaveBeenCalledOnce();
        expect(delegate).toHaveBeenCalledWith(7, 'eth_chainId', []);
    });

    it('does not mount service or wallet routes', async () => {
        const app = buildTestApp();

        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: async () => {},
            buildContext: () => {
                throw new Error('not reached');
            },
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });

        const [service, wallet] = await Promise.all([
            app.inject({ method: 'POST', url: '/rpc/service', payload: {} }),
            app.inject({ method: 'POST', url: '/rpc/wallet/token', payload: {} })
        ]);

        expect(service.statusCode).toBe(404);
        expect(wallet.statusCode).toBe(404);
    });

    it('stops before authorization and delegation when authentication fails', async () => {
        const delegate = vi.fn();
        const authenticate = vi.fn(async () => {
            throw new UnauthorizedError();
        });
        const buildContext = vi.fn();
        const app = buildTestApp();

        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: authenticate,
            buildContext,
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });

        const response = await app.inject({
            method: 'POST',
            url: '/rpc',
            payload: { jsonrpc: '2.0', id: 8, method: 'eth_chainId', params: [] }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ id: 8, error: { code: UNAUTHORIZED_ERROR_CODE } });
        expect(authenticate).toHaveBeenCalledOnce();
        expect(buildContext).not.toHaveBeenCalled();
        expect(delegate).not.toHaveBeenCalled();
    });
});

describe('regularRpcRoutes optional capabilities', () => {
    const bundlerDisabled = { code: METHOD_NOT_FOUND_ERROR_CODE, message: 'Bundler is not enabled' };

    async function callSupportedEntryPoints(context: RegularRpcContext) {
        const app = buildTestApp();
        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: async () => {},
            buildContext: () => context,
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });

        return app.inject({
            method: 'POST',
            url: '/rpc',
            payload: { jsonrpc: '2.0', id: 1, method: 'eth_supportedEntryPoints', params: [] }
        });
    }

    function minimalContext(): RegularRpcContext {
        return {
            targetRpc: { chainType: 'besu', delegate: vi.fn() } as unknown as ExternalRpc,
            authorizer: { hasFullSequencerAccess: async () => false } as unknown as Authorizer
        };
    }

    it('fails closed when the application omits the capability', async () => {
        const response = await callSupportedEntryPoints(minimalContext());

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ id: 1, error: bundlerDisabled });
    });

    it('fails closed when the application supplies the capability as undefined', async () => {
        const response = await callSupportedEntryPoints({ ...minimalContext(), bundlerRpc: undefined });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ id: 1, error: bundlerDisabled });
    });
});

describe('regularRpcRoutes batch validation', () => {
    const invalidRequest = { code: INVALID_REQUEST_ERROR_CODE };

    function registerRoutes(): FastifyServer {
        const app = buildTestApp();
        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: async () => {},
            buildContext: () => ({
                targetRpc: { chainType: 'besu', delegate: vi.fn() } as unknown as ExternalRpc,
                authorizer: { hasFullSequencerAccess: async () => false } as unknown as Authorizer
            }),
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });
        return app;
    }

    function emptyBatch(length: number): Record<string, never>[] {
        return Array.from({ length }, () => ({}));
    }

    it('rejects a batch over the size limit before validating its items', async () => {
        const app = registerRoutes();

        const response = await app.inject({ method: 'POST', url: '/rpc', payload: emptyBatch(MAX_RPC_BATCH_SIZE + 1) });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            error: { ...invalidRequest, message: `Batch too large: at most ${MAX_RPC_BATCH_SIZE} requests per batch` }
        });
    });

    it('still validates a batch at the size limit', async () => {
        const app = registerRoutes();

        const response = await app.inject({ method: 'POST', url: '/rpc', payload: emptyBatch(MAX_RPC_BATCH_SIZE) });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ error: { ...invalidRequest, message: 'Bad rpc request' } });
    });

    it('answers a huge malformed batch in constant time', async () => {
        const app = registerRoutes();
        const startedAt = performance.now();

        const response = await app.inject({ method: 'POST', url: '/rpc', payload: emptyBatch(100_000) });

        // Validating every item took ~2.7 s here before the size gate; the gate itself is O(1).
        expect(performance.now() - startedAt).toBeLessThan(1_000);
        expect(response.json()).toMatchObject({ error: invalidRequest });
    });
});
