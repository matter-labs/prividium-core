import fastify, {
    type FastifyBaseLogger,
    type FastifyRequest,
    type FastifyTypeProvider,
    type HookHandlerDoneFunction,
    type RawReplyDefaultExpression,
    type RawRequestDefaultExpression,
    type RawServerBase,
    type RouteOptions
} from 'fastify';
import type { FastifyInstance } from 'fastify/types/instance';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export type { Counter, Histogram };

export const HTTP_REQUEST_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

declare module 'fastify' {
    interface FastifyRequest {
        metricsStartTime: number;
        metricPathName: string;
        metricApiHandlerRole?: string;
    }
}

export function addStartTimeHook<
    A extends RawServerBase,
    B extends RawRequestDefaultExpression<A>,
    C extends RawReplyDefaultExpression<A>,
    D extends FastifyBaseLogger,
    E extends FastifyTypeProvider
>(app: FastifyInstance<A, B, C, D, E>) {
    app.addHook('onRequest', (req, _reply, done) => {
        req.metricsStartTime = Date.now();
        done();
    });
}

export function saveRouteNames<
    A extends RawServerBase,
    B extends RawRequestDefaultExpression<A>,
    C extends RawReplyDefaultExpression<A>,
    D extends FastifyBaseLogger,
    E extends FastifyTypeProvider
>(app: FastifyInstance<A, B, C, D, E>) {
    app.addHook('onRoute', (routeOptions: RouteOptions) => {
        const handler = (req: FastifyRequest, _reply: unknown, done: HookHandlerDoneFunction): void => {
            req.metricPathName = routeOptions.url;
            // Only set if not already set (allows RPC routes to override)
            if (!req.metricApiHandlerRole) {
                req.metricApiHandlerRole = deriveRoleFromUrl(routeOptions.url);
            }
            done();
        };

        if (Array.isArray(routeOptions.onRequest)) {
            routeOptions.onRequest.push(handler);
        } else if (routeOptions.onRequest === undefined) {
            routeOptions.onRequest = handler;
        } else {
            routeOptions.onRequest = [routeOptions.onRequest, handler];
        }
    });
}

function deriveRoleFromUrl(url: string): string {
    // Remove /api prefix if present
    const path = url.replace(/^\/api/, '');

    // Get path segments, stop at route parameters
    const segments = path.split('/').filter(Boolean);
    const meaningfulSegments: string[] = [];
    for (const seg of segments) {
        if (seg.startsWith(':')) break;
        meaningfulSegments.push(seg);
    }

    // Join with dashes: "/admin/sessions" -> "admin-sessions"
    return meaningfulSegments.join('-') || 'unknown';
}

export class MetricsServer {
    app: FastifyInstance;
    register: Registry;

    constructor(serviceName: string) {
        this.app = fastify({ logger: false });
        this.register = new Registry();

        this.register.setDefaultLabels({
            service: serviceName
        });

        this.app.get('/metrics', async (_req, reply) => {
            reply.send(await this.register.metrics());
        });
    }

    counter(name: string, help: string, labelNames: string[]): Counter {
        return new Counter({
            registers: [this.register],
            name,
            help,
            labelNames
        });
    }

    histogram(name: string, help: string, labelNames: string[], buckets: number[]): Histogram {
        return new Histogram({
            name,
            help,
            labelNames,
            buckets,
            registers: [this.register]
        });
    }

    gauge(name: string, help: string, labelNames: string[] = []): Gauge {
        return new Gauge({
            registers: [this.register],
            name,
            help,
            labelNames
        });
    }

    listen(port: number): Promise<string> {
        return this.app.listen({ port, host: '0.0.0.0' });
    }

    async close(): Promise<void> {
        await this.app.close();
    }
}
