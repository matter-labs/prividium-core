import rateLimit from '@fastify/rate-limit';
import { hasZoneSystemPermission } from '@repo/access-control';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RateLimitError } from '../utils/error-types';

export interface RateLimitConfig {
    enabled: boolean;
    auth: { max: number };
    public: { max: number };
    user: { max: number };
    rpc: { max: number };
    m2m: { max: number };
    windowMs: number;
}

export async function registerRateLimitForScope(
    app: FastifyInstance,
    opts: { max: number; timeWindow: number; keyGenerator?: (req: FastifyRequest) => string }
) {
    await app.register(rateLimit, {
        max: opts.max,
        timeWindow: opts.timeWindow,
        keyGenerator: opts.keyGenerator ?? ((req) => req.ip),
        errorResponseBuilder: (_req, context) =>
            new RateLimitError(
                `Rate limit exceeded. Try again in ${Math.ceil(Number(context.after.split(' ')[0]))} seconds.`
            ),
        addHeaders: {
            'x-ratelimit-limit': true,
            'x-ratelimit-remaining': true,
            'x-ratelimit-reset': true,
            'retry-after': true
        },
        global: false
    });

    app.addHook('onRequest', app.rateLimit());
}

export interface GlobalRateLimitOpts {
    max: number | ((req: FastifyRequest, key: string) => number);
    keyGenerator: (req: FastifyRequest) => string;
    hook?: 'onRequest' | 'preHandler';
}

export function registerGlobalRateLimit(app: FastifyInstance, config: RateLimitConfig, opts: GlobalRateLimitOpts) {
    if (!config.enabled) return;

    app.register(rateLimit, {
        max: opts.max,
        timeWindow: config.windowMs,
        keyGenerator: opts.keyGenerator,
        allowList: (req) => isTrustedActor(req),
        errorResponseBuilder: (_req, context) =>
            new RateLimitError(
                `Rate limit exceeded. Try again in ${Math.ceil(Number(context.after.split(' ')[0]))} seconds.`
            ),
        addHeaders: {
            'x-ratelimit-limit': true,
            'x-ratelimit-remaining': true,
            'x-ratelimit-reset': true,
            'retry-after': true
        },
        ...(opts.hook && { hook: opts.hook })
    });
}

export function userKeyGenerator(req: FastifyRequest): string {
    const userId = req.auth?.currentUser?.()?.id;
    return userId ? `user:${userId}` : `ip:${req.ip}`;
}

export function actorKeyGenerator(req: FastifyRequest): string {
    const defaultKey = () => `ip:${req.ip}`;

    try {
        switch (req.auth.type) {
            case 'user': {
                const userId = req.auth.currentUser?.()?.id;
                return userId ? `user:${userId}` : defaultKey();
            }
            case 'm2m_app':
                return `m2m:${req.auth.currentApiKeyId()}`;
            default:
                return defaultKey();
        }
    } catch {
        return defaultKey();
    }
}

export function actorMax(config: RateLimitConfig): (req: FastifyRequest) => number {
    return (req) => (req.auth?.type === 'm2m_app' ? config.m2m.max : config.rpc.max);
}

export function isTrustedActor(req: FastifyRequest): boolean {
    const auth = req.auth;
    if (!auth) return false;

    if (auth.type === 'tenant') return true;

    if (auth.type === 'service') return true;

    if (auth.type === 'user') {
        try {
            const user = auth.currentUser();
            return (
                hasZoneSystemPermission(user, 'full_sequencer_rpc_access') ||
                hasZoneSystemPermission(user, 'full_read_access') ||
                hasZoneSystemPermission(user, 'contract_deployment') ||
                hasZoneSystemPermission(user, 'admin_read')
            );
        } catch {
            return false;
        }
    }

    return false;
}
