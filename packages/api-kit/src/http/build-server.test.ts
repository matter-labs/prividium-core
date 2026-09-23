import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer, KEEP_ALIVE_TIMEOUT_MS } from './build-server';

const noop = () => {};
const silentLogger = {
    level: 'silent',
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    child() {
        return silentLogger;
    }
} as unknown as FastifyBaseLogger;

const apps: ReturnType<typeof createApiServer>[] = [];

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('createApiServer', () => {
    it('keeps idle connections open longer than the load balancer does', async () => {
        const app = createApiServer({ logger: silentLogger });
        apps.push(app);
        await app.ready();

        expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(600_000);
        expect(app.server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    });
});
