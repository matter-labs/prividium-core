import { boundedLabelValue } from '@repo/api-metrics';
import type { FastifyServer } from '../build-app';
import { createBaseRpcMethodList } from '../rpc/methods/base-rpc-method-list';
import { serviceHandlers } from '../rpc/methods/service-rpc-method-list';
import { walletHandlers } from '../rpc/methods/wallet-rpc-method-list';
import { jsonPrcRequestCounter, jsonPrcRequestDuration } from '../utils/metrics';

// Every name some RPC surface registers, with every optional handler switched on. Any other value
// is client-chosen and would pin a new metric series for the life of the process.
const meteredMethodNames: ReadonlySet<string> = new Set(
    [...createBaseRpcMethodList([], true), ...walletHandlers, ...serviceHandlers].map(({ name }) => name)
);

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
            method: boundedLabelValue(meteredMethodNames, reply.rpcRoute, 'unknown'),
            status_code: reply.rpcStatusCode,
            role: reply.metricRpcHandlerRole,
            result: reply.rpcStatusCode >= 0 ? 'success' : 'error'
        };
        jsonPrcRequestCounter.inc(labels);
        jsonPrcRequestDuration.observe(labels, (Date.now() - request.metricsStartTime) / 1000);
    });
}
