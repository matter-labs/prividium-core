import { clearAuditSessionVars, setAuditSessionVarsSql } from '@repo/api-kit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { FastifyServer } from '../build-app';
import type { DB, DbOrTx } from '../db';
import { createRequestScopedDb, Repositories } from '../db';
import type { AuditResourceType } from '../db/schema';
import { type AuditLogContext, type AuditLogsService, auditLogContext } from '../services/audit-logs-service';
import { ServiceOverloadedError } from '../utils/error-types';

export const SERVICE_NAME = 'permissions-api' as const;

// Handlers still reach pool-backed repositories, and drizzle opens a second connection per transaction on a
// pool-bound session; were pinned clients to hold every slot, those nested acquisitions could never complete.
const RESERVED_POOL_CONNECTIONS = 2;

const DEFAULT_SLOT_WAIT_MS = 5_000;

const DEFAULT_POOL_MAX = 10;

type PoolOptions = { max?: number; connectionTimeoutMillis?: number };

export interface AuditEventDetails {
    resourceType?: AuditResourceType;
    resourceId?: string;
    actionDetails?: Record<string, unknown>;
}

declare module 'fastify' {
    interface FastifyRequest {
        auditContext: AuditLogContext;
        auditEventDetails?: AuditEventDetails;
        /** Request-scoped DB used for audit trigger context when the route needs it. */
        auditDb?: DbOrTx;
        /** Dedicated DB connection for this request. Set by audit-context middleware; released in onResponse. */
        auditDbClient?: PoolClient;
        /** Frees this request's pinned-client slot. Set alongside `auditDbClient`; called during cleanup. */
        auditPoolSlotRelease?: () => void;
    }
}

/**
 * Bounds concurrent pinned clients so the pool always keeps {@link RESERVED_POOL_CONNECTIONS} slots free.
 * Waiters are served FIFO and give up with 503 rather than queueing without limit.
 */
class PinnedClientLimiter {
    private pinned = 0;
    private readonly waiting = new Set<() => void>();

    constructor(
        private readonly limit: number,
        private readonly waitTimeoutMs: number
    ) {}

    /** Resolves with a one-shot release once a slot is held. */
    async acquire(): Promise<() => void> {
        if (this.pinned < this.limit) {
            this.pinned += 1;
        } else {
            await this.waitForSlot();
        }

        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.handOverOrFree();
        };
    }

    private waitForSlot(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout>;
            const grant = () => {
                clearTimeout(timer);
                resolve();
            };
            timer = setTimeout(() => {
                this.waiting.delete(grant);
                reject(new ServiceOverloadedError('Database connection pool is saturated'));
            }, this.waitTimeoutMs);
            this.waiting.add(grant);
        });
    }

    // The slot passes straight to the next waiter, so `pinned` only drops when nobody is queued.
    private handOverOrFree(): void {
        const next = this.waiting.values().next();
        if (next.done) {
            this.pinned -= 1;
            return;
        }
        this.waiting.delete(next.value);
        next.value();
    }
}

// build-app registers the middleware once per route scope, but every scope draws on the same pool,
// so the reserved-slot budget must be shared: one limiter per pool, not per middleware instance.
const limiterByPool = new WeakMap<object, PinnedClientLimiter>();

// Falls back to the pool defaults: `build-app` is also booted without a database to emit the OpenAPI spec.
function pinnedClientLimiterFor(db: DB): PinnedClientLimiter {
    const pool = (db as { $client?: { options?: PoolOptions } } | null)?.$client;
    const existing = pool && limiterByPool.get(pool);
    if (existing) return existing;

    const max = pool?.options?.max ?? DEFAULT_POOL_MAX;
    const limiter = new PinnedClientLimiter(
        Math.max(1, max - RESERVED_POOL_CONNECTIONS),
        pool?.options?.connectionTimeoutMillis ?? DEFAULT_SLOT_WAIT_MS
    );
    if (pool) limiterByPool.set(pool, limiter);
    return limiter;
}

/**
 * Acquires a dedicated `PoolClient` for the request and sets up the full
 * audit environment in a single step:
 *
 * 1. Writes session-level `app.*` vars (`set_config(…, false)`) so that
 *    every Postgres trigger on this connection can read actor/trace context
 *    via `current_setting('app.*')` — no per-transaction SET LOCAL needed.
 *
 * 2. Inserts one row into `audit_request_log` mapping `request_id` → business
 *    operation name derived from `"METHOD /route/pattern"`.
 *    DB mutation trigger rows (`db_mutation_audit_logs`) carry the same
 *    `request_id`, so they can be joined to recover the business context.
 *
 * 3. Replaces `request.repos` with a `Repositories` instance backed by the
 *    dedicated client so all handler DB calls share one connection and
 *    therefore the same session config.
 *
 * Call `registerAuditContextCleanup(app)` once during app setup to register
 * the hooks that reset session vars and release the client after each response.
 */
export function createAuditContextMiddleware(auditLogsService: AuditLogsService, db: DB) {
    const limiter = pinnedClientLimiterFor(db);

    return async function auditContextMiddleware(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
        request.auditContext = auditLogContext(request, auditLogsService);

        if (request.routeOptions.config?.audit_db_context === false) {
            return;
        }

        // Derive the operation name from "METHOD /route/pattern".
        const normalizedRoutePattern = request.routeOptions.url ?? '/';
        const operation = `${request.method} ${normalizedRoutePattern}`;

        const releaseSlot = await limiter.acquire();

        let client: PoolClient;
        try {
            client = await db.$client.connect();
        } catch (err) {
            releaseSlot();
            throw err;
        }

        request.auditDbClient = client;
        request.auditPoolSlotRelease = releaseSlot;

        try {
            // Single round-trip: set session vars and insert request log together.
            // set_config with is_local=false persists on the connection (not just
            // the current transaction) so every subsequent query on this dedicated
            // client sees the audit context via current_setting('app.*').
            await client.query(
                `WITH session AS (
                    SELECT ${setAuditSessionVarsSql()}
                )
                INSERT INTO audit_request_log
                    (request_id, trace_id, operation, actor_id, actor_type, auth_subject,
                     service_name, method, url, ip, user_agent)
                SELECT $2, $1, $7, $3, $4, $5, $6, $8, $9, $10, $11
                FROM session`,
                [
                    request.auditContext.traceId, // $1
                    request.auditContext.requestId, // $2
                    request.auditContext.activeUserId ??
                        request.auditContext.activeTenantId ??
                        request.auditContext.activeServiceId ??
                        null, // $3
                    request.auditContext.actorType, // $4
                    request.auditContext.authSubject ?? null, // $5
                    SERVICE_NAME, // $6
                    operation, // $7
                    request.method, // $8
                    normalizedRoutePattern, // $9
                    request.ip ?? null, // $10
                    request.headers['user-agent'] ?? null // $11
                ]
            );

            const scopedDb = createRequestScopedDb(client);
            request.auditDb = scopedDb;
            request.repos = new Repositories(scopedDb);
        } catch (err) {
            request.auditDb = undefined;
            request.auditDbClient = undefined;
            request.auditPoolSlotRelease = undefined;
            client.release();
            releaseSlot();
            throw err;
        }
    };
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Registers `onResponse` and `onRequestAbort` hooks that:
 *  1. Emit a semantic audit event to `audit_logs` at response time (outcome known).
 *     - Uses `config.audit_action` if declared on the route.
 *     - Falls back to `api.mutation` for POST/PUT/PATCH/DELETE without declaration.
 *     - GET routes are skipped unless `audit_action` is explicitly set (sensitive reads).
 *  2. Reset session-level audit vars on the dedicated DB client.
 *  3. Release the dedicated DB client back to the pool.
 *
 * Call this once during app setup.
 */
export function registerAuditContextCleanup(app: FastifyServer) {
    app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
        const auditContext = request.auditContext;
        if (!auditContext) return;

        const declaredAction = request.routeOptions.config?.audit_action;
        const isMutating = MUTATING_METHODS.has(request.method);

        if (!declaredAction && !isMutating) return;

        const actionType = declaredAction ?? 'api.mutation';
        const operation = `${request.method} ${request.routeOptions.url ?? '/'}`;
        const result = reply.statusCode < 400 ? 'success' : 'failure';
        const auditEventDetails = request.auditEventDetails;

        try {
            await auditContext.logSecurityEvent(
                actionType,
                auditEventDetails?.resourceType ?? 'request',
                auditEventDetails?.resourceId,
                {
                    operation,
                    statusCode: reply.statusCode,
                    result,
                    ...auditEventDetails?.actionDetails
                },
                request.auditDb
            );
        } catch (err) {
            request.log.error({ err }, 'Failed to emit business audit event');
        }
    });

    const releaseClient = async (request: FastifyRequest) => {
        const client = request.auditDbClient;
        if (!client) return;
        const releaseSlot = request.auditPoolSlotRelease;
        request.auditDb = undefined;
        request.auditDbClient = undefined;
        request.auditPoolSlotRelease = undefined;
        try {
            await clearAuditSessionVars(client);
        } finally {
            client.release();
            releaseSlot?.();
        }
    };

    app.addHook('onResponse', releaseClient);
    app.addHook('onRequestAbort', releaseClient);
}
