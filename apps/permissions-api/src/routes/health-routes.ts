import type { FastifyServer } from '../build-app';
import type { HealthCheckService } from '../services/health-check-service';

type Deps = {
    healthCheckService: HealthCheckService;
};

export function healthRoutes(app: FastifyServer, deps: Deps) {
    app.get('/readyz', async (_req, reply) => {
        const status = deps.healthCheckService.getStatus();
        const code = status.ok ? 200 : 500;
        return reply.status(code).send({
            ok: status.ok,
            checks: status.checks,
            updatedAt: status.updatedAt,
            version: status.version
        });
    });

    app.get('/health', async (_req, reply) => {
        const status = deps.healthCheckService.getStatus();
        const code = status.ok ? 200 : 500;
        return reply.status(code).send({
            ok: status.ok,
            checks: status.checks,
            updatedAt: status.updatedAt,
            version: status.version
        });
    });
}
