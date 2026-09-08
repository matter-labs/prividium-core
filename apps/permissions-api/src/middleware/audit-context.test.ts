import { AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyContextConfig } from 'fastify';
import Fastify from 'fastify';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyServer } from '../build-app';
import type { DB, Repositories } from '../db';
import { errorHandler } from '../error-handler';
import type { AuditLogsService } from '../services/audit-logs-service';
import { createAuditContextMiddleware, registerAuditContextCleanup } from './audit-context';

type PoolShape = { max: number; connectionTimeoutMillis: number };

function buildAuditContextTestApp(
    routeConfig: FastifyContextConfig,
    opts: { pool?: PoolShape; blockUntil?: Promise<void> } = {}
) {
    const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn()
    } as unknown as PoolClient;
    const connect = vi.fn().mockResolvedValue(client);
    const db = { $client: { connect, options: opts.pool } } as unknown as DB;
    const logSecurityEvent = vi.fn().mockResolvedValue(undefined);
    const auditLogsService = {
        logSecurityEvent
    } as unknown as AuditLogsService;

    const app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
        request.requestId = 'request-id';
        request.traceId = 'trace-id';
        request.requestStartedAt = Date.now();
        request.repos = {} as Repositories;
        done();
    });
    app.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
    registerAuditContextCleanup(app as unknown as FastifyServer);
    app.setErrorHandler(errorHandler);
    app.post(
        '/test',
        {
            config: routeConfig
        },
        async () => ({ ok: true })
    );
    app.post('/blocking', { config: routeConfig }, async () => {
        await opts.blockUntil;
        return { ok: true };
    });

    return { app, client, connect, logSecurityEvent };
}

describe('audit context middleware', () => {
    it('does not acquire a pool client when DB audit context is disabled', async () => {
        const { app, connect, logSecurityEvent } = buildAuditContextTestApp({
            audit_action: AUDIT_ACTIONS.APPLICATION_CREATE,
            audit_db_context: false
        });

        try {
            const response = await app.inject({ method: 'POST', url: '/test' });

            expect(response.statusCode).toBe(200);
            expect(connect).not.toHaveBeenCalled();
            expect(logSecurityEvent).toHaveBeenCalledOnce();
            expect(logSecurityEvent.mock.calls[0]?.[5]).toBeUndefined();
        } finally {
            await app.close();
        }
    });

    it('writes response audit events through the request-scoped DB when one is held', async () => {
        const { app, client, connect, logSecurityEvent } = buildAuditContextTestApp({
            audit_action: AUDIT_ACTIONS.APPLICATION_CREATE
        });

        try {
            const response = await app.inject({ method: 'POST', url: '/test' });

            expect(response.statusCode).toBe(200);
            expect(connect).toHaveBeenCalledOnce();
            expect(logSecurityEvent).toHaveBeenCalledOnce();
            expect(logSecurityEvent.mock.calls[0]?.[5]).toBeDefined();
            expect(client.query).toHaveBeenCalledTimes(2);
            expect(client.release).toHaveBeenCalledOnce();
        } finally {
            await app.close();
        }
    });
});

describe('pinned client limiter', () => {
    function deferred() {
        let resolve: () => void = () => {};
        const promise = new Promise<void>((r) => {
            resolve = r;
        });
        return { promise, resolve };
    }

    // A pinned client is held for the whole request, so the pool must keep slots for the nested
    // acquisitions handlers make through the pool-backed service repositories.
    it('leaves pool connections unpinned while requests are in flight', async () => {
        const blocked = deferred();
        const { app, connect } = buildAuditContextTestApp(
            { audit_action: AUDIT_ACTIONS.APPLICATION_CREATE },
            { pool: { max: 4, connectionTimeoutMillis: 10_000 }, blockUntil: blocked.promise }
        );

        try {
            await app.ready();
            const inFlight = [
                app.inject({ method: 'POST', url: '/blocking' }),
                app.inject({ method: 'POST', url: '/blocking' }),
                app.inject({ method: 'POST', url: '/blocking' })
            ];
            await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));

            // The third request waits for a slot rather than taking the pool down to zero.
            expect(connect).toHaveBeenCalledTimes(2);

            blocked.resolve();
            const responses = await Promise.all(inFlight);

            expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
            expect(connect).toHaveBeenCalledTimes(3);
        } finally {
            blocked.resolve();
            await app.close();
        }
    });

    it('rejects with 503 instead of waiting for a slot forever', async () => {
        const blocked = deferred();
        const { app, connect } = buildAuditContextTestApp(
            { audit_action: AUDIT_ACTIONS.APPLICATION_CREATE },
            { pool: { max: 3, connectionTimeoutMillis: 20 }, blockUntil: blocked.promise }
        );

        try {
            await app.ready();
            const blocking = app.inject({ method: 'POST', url: '/blocking' });
            await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));

            const rejected = await app.inject({ method: 'POST', url: '/test' });

            expect(rejected.statusCode).toBe(503);
            expect(rejected.json().error.code).toBe('SERVICE_OVERLOADED');

            blocked.resolve();
            expect((await blocking).statusCode).toBe(200);
        } finally {
            blocked.resolve();
            await app.close();
        }
    });

    // build-app registers the middleware once per route scope (admin, user, organizations, ...); all
    // scopes drain the same pool, so the pinned budget must hold across instances, not per instance.
    it('shares the pinned budget across middleware instances on the same pool', async () => {
        const blocked = deferred();
        const client = {
            query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            release: vi.fn()
        } as unknown as PoolClient;
        const connect = vi.fn().mockResolvedValue(client);
        const db = { $client: { connect, options: { max: 3, connectionTimeoutMillis: 20 } } } as unknown as DB;
        const auditLogsService = {
            logSecurityEvent: vi.fn().mockResolvedValue(undefined)
        } as unknown as AuditLogsService;

        const app = Fastify();
        app.addHook('onRequest', (request, _reply, done) => {
            request.requestId = 'request-id';
            request.traceId = 'trace-id';
            request.requestStartedAt = Date.now();
            request.repos = {} as Repositories;
            done();
        });
        registerAuditContextCleanup(app as unknown as FastifyServer);
        app.setErrorHandler(errorHandler);
        app.register(async (scope) => {
            scope.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
            scope.post('/scope-a', async () => {
                await blocked.promise;
                return { ok: true };
            });
        });
        app.register(async (scope) => {
            scope.addHook('preHandler', createAuditContextMiddleware(auditLogsService, db));
            scope.post('/scope-b', async () => ({ ok: true }));
        });

        try {
            await app.ready();
            const blocking = app.inject({ method: 'POST', url: '/scope-a' });
            await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));

            const rejected = await app.inject({ method: 'POST', url: '/scope-b' });

            expect(rejected.statusCode).toBe(503);
            expect(rejected.json().error.code).toBe('SERVICE_OVERLOADED');

            blocked.resolve();
            expect((await blocking).statusCode).toBe(200);
        } finally {
            blocked.resolve();
            await app.close();
        }
    });

    it('frees the slot after each response so later requests still get a client', async () => {
        const { app, connect } = buildAuditContextTestApp(
            { audit_action: AUDIT_ACTIONS.APPLICATION_CREATE },
            { pool: { max: 3, connectionTimeoutMillis: 20 } }
        );

        try {
            for (let i = 0; i < 5; i++) {
                const response = await app.inject({ method: 'POST', url: '/test' });
                expect(response.statusCode).toBe(200);
            }

            expect(connect).toHaveBeenCalledTimes(5);
        } finally {
            await app.close();
        }
    });
});
