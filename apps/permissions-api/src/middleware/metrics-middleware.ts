import { addStartTimeHook, saveRouteNames } from '@repo/api-metrics';
import type { FastifyServer } from '../build-app';
import { httpRequestCounter, httpRequestDuration } from '../utils/metrics';

export function registerMetricMiddlewares(app: FastifyServer) {
    // Register metrics tracking hooks
    addStartTimeHook(app);
    saveRouteNames(app);

    app.addHook('onResponse', async (request, reply) => {
        if (request.metricPathName) {
            const duration = (Date.now() - request.metricsStartTime) / 1000;
            const route = request.metricPathName;
            const method = request.method;
            let result: string;
            if (reply.statusCode >= 200 && reply.statusCode < 300) {
                result = 'success';
            } else {
                result = 'error';
            }
            httpRequestDuration.observe(
                { method: method, route, status_code: reply.statusCode, role: request.metricApiHandlerRole, result },
                duration
            );
            httpRequestCounter.inc({
                route,
                method,
                status_code: reply.statusCode,
                role: request.metricApiHandlerRole,
                result
            });
        }
    });
}
