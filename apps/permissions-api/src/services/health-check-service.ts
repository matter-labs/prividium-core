import { sql } from 'drizzle-orm';
import type { DB } from '../db';
import type { PinoLogger } from '../utils/logger';

export type HealthCheckResult = {
    ok: boolean;
    error?: string;
};

export type CachedHealthStatus = {
    ok: boolean;
    checks: Record<string, HealthCheckResult>;
    updatedAt: string;
    version: string;
};

type Deps = {
    db: DB;
    logger: PinoLogger;
    intervalMs: number;
    version: string;
};

export class HealthCheckService {
    private readonly db: DB;
    private readonly logger: PinoLogger;
    private readonly intervalMs: number;
    private readonly staleAfterMs: number;
    private readonly version: string;
    private cache: CachedHealthStatus = {
        ok: false,
        checks: {},
        updatedAt: new Date(0).toISOString(),
        version: 'unknown'
    };
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(deps: Deps) {
        this.db = deps.db;
        this.logger = deps.logger.child({ role: 'HealthCheckService' });
        this.intervalMs = deps.intervalMs;
        // A probe that stops completing leaves the cache frozen on its last result; past this age the
        // cached `ok` is no longer evidence the database is reachable.
        this.staleAfterMs = Math.max(deps.intervalMs * 5, 15_000);
        this.version = deps.version;
    }

    async start(): Promise<void> {
        if (this.timer !== null) {
            return;
        }

        const scheduleNext = () => {
            this.timer = setTimeout(() => {
                void this.runCheck().finally(() => {
                    scheduleNext();
                });
            }, this.intervalMs);
            // Do not keep the event loop alive just for health checks
            this.timer.unref?.();
        };

        // Run the first check before serving traffic so /readyz never reports
        // healthy without an actual DB probe. checkDatabase() catches its own
        // errors and writes ok:false into the cache on failure.
        await this.runCheck();
        scheduleNext();

        this.logger.info({ intervalMs: this.intervalMs }, 'Health check service started');
    }

    stop(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
            this.logger.info('Health check service stopped');
        }
    }

    getStatus(): CachedHealthStatus {
        const ageMs = Date.now() - Date.parse(this.cache.updatedAt);
        if (!this.cache.ok || ageMs <= this.staleAfterMs) {
            return { ...this.cache };
        }

        return {
            ...this.cache,
            ok: false,
            checks: {
                ...this.cache.checks,
                liveness: { ok: false, error: `health check has not completed for ${ageMs}ms` }
            }
        };
    }

    async runCheck(): Promise<void> {
        const checks: Record<string, HealthCheckResult> = {};
        const databaseResult = await this.checkDatabase();
        checks.database = databaseResult;

        const ok = Object.values(checks).every((c) => c.ok);
        this.cache = {
            ok,
            checks,
            updatedAt: new Date().toISOString(),
            version: this.version
        };
        if (!ok) {
            this.logger.warn({ checks: this.cache.checks }, 'Health check failed');
        }
    }

    private async checkDatabase(): Promise<HealthCheckResult> {
        try {
            await this.db.execute(sql`SELECT 1`);
            return { ok: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.debug({ err }, 'Database health check failed');
            return { ok: false, error: message };
        }
    }
}
