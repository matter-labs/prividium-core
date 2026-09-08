import type { FastifyServer } from '../build-app';
import { jsonPrcRequestCounter, jsonPrcRequestDuration } from '../utils/metrics';

/**
 * Reports JSON-RPC metrics for every {@link rpcTransport} registered in this scope or below it.
 * Call it directly rather than through `register` — a nested plugin's hooks would not reach the route.
 */
export function rpcMetrics(app: FastifyServer): void {
    app.addHook('onRequest', async (request) => {
        request.metricsStartTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
        if (reply.rpcRoute === undefined) return;

        const labels = {
            method: reply.rpcRoute,
            status_code: reply.rpcStatusCode,
            role: reply.metricRpcHandlerRole,
            result: reply.rpcStatusCode >= 0 ? 'success' : 'error'
        };
        jsonPrcRequestCounter.inc(labels);
        jsonPrcRequestDuration.observe(labels, (Date.now() - request.metricsStartTime) / 1000);
    });
}
