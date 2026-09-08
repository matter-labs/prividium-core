import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '../db';
import type { PinoLogger } from '../utils/logger';
import { HealthCheckService } from './health-check-service';

function buildService(execute: () => Promise<unknown>) {
    const logger = {
        child: () => logger,
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn()
    } as unknown as PinoLogger;

    return new HealthCheckService({
        db: { execute } as unknown as DB,
        logger,
        intervalMs: 1_000,
        version: 'test'
    });
}

describe('health check service', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports the last successful probe while it is fresh', async () => {
        const service = buildService(async () => ({}));
        await service.runCheck();

        expect(service.getStatus().ok).toBe(true);
    });

    // The probe goes through the same pool as request traffic. When it stops completing, the cached
    // result freezes on its last success, which is what let /health report green through an outage.
    it('reports unhealthy once the probe has stopped completing', async () => {
        const service = buildService(async () => ({}));
        await service.runCheck();

        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 30_000);

        const status = service.getStatus();
        expect(status.ok).toBe(false);
        expect(status.checks.liveness?.ok).toBe(false);
    });

    it('reports unhealthy when the probe fails', async () => {
        const service = buildService(async () => {
            throw new Error('connection timeout');
        });
        await service.runCheck();

        const status = service.getStatus();
        expect(status.ok).toBe(false);
        expect(status.checks.database?.error).toBe('connection timeout');
    });
});
