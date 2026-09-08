import { type AdmitDeniedHook, type AuthorizationOverlay, type CoreFacts, createApiServer } from '@repo/api-kit';
import type { Pool } from 'pg';
import type { FeatureRuntime } from './build-app';
import { RepositoriesCoreFacts } from './core-facts/repositories-core-facts';
import { type DB, Repositories } from './db';
import { errorHandler } from './error-handler';
import { admitRoutes } from './routes/admit-routes';
import { judgeRoutes } from './routes/judge-routes';
import { TargetRpc } from './rpc/target-rpc';
import { AdmitService } from './services/admit-service';
import { AuthorizationService } from './services/authorization-service';
import { InMemoryDecisionCache } from './services/decision-cache';
import { JudgeService } from './services/judge-service';
import { TransactionClassifier } from './services/transaction-classifier';
import { UnauthorizedError } from './utils/error-types';
import type { PinoLogger } from './utils/logger';
import { metricsServer } from './utils/metrics';

export type PolicyAppConfig = {
    logger: PinoLogger;
    /** Versions accepted on the request. First entry is the preferred version,
     * advertised on the response when the request's version doesn't match. */
    protocolVersions: string[];
    /** Static bearer token; every request to /admit and /judge must carry
     * `Authorization: Bearer <token>`. Env validation requires POLICY_AUTH_TOKEN
     * whenever POLICY_PORT is set, so it is only absent in tests. */
    authToken?: string;
    /** When true, the authorization service enforces organization isolation on contract calls
     * (org users reach only their org's contracts + zone-level contracts). */
    multiOrgEnabled: boolean;
    /** Chain RPC URL used to classify bare value transfers (eth_getCode on the
     * recipient). A transfer to an EOA runs no code and is allowed without a
     * permission row; a transfer to a contract stays gated. Same URL the main
     * app uses for `chainRpc` (`SEQUENCER_RPC_URL`). */
    targetRpcUrl: string;
    /**
     * When set, admit/judge decisions are cached in-memory (read-through, TTL).
     * Absent disables caching (every call evaluates against the DB). The same
     * tx is evaluated at mempool inclusion and again at block building, so the
     * repeat is a guaranteed hit. Invalidation is TTL-only.
     */
    decisionCache?: { ttlMs: number; maxEntries: number };
    /** Told of every refused `/admit` check. A provider, like the overlays, for the same reason. */
    onAdmitDenied?: (runtime: FeatureRuntime) => AdmitDeniedHook;
    /**
     * A private feature's narrowing stage, consulted after the capability gate
     * allows a transaction. A provider rather than an instance because it reads
     * through the repositories this function builds.
     *
     * Absent leaves behaviour unchanged. Enabled-but-unreachable is a denial, not
     * an allow: see `AdmitService.overlayVerdict`.
     */
    authorizationOverlays?: (context: { coreFacts: CoreFacts; pool: Pool }) => readonly AuthorizationOverlay[];
};

/**
 * Builds a separate Fastify app that serves only `/admit` and `/judge` over
 * plain HTTP with bearer-token auth. These routes are invoked
 * exclusively by `zksync-os-server`'s `PolicyClient`.
 *
 * The user-facing routes (admin / user / tenant / public) live on the main
 * `buildApp` listener and use SIWE/JWT auth — the two transport postures
 * don't share a listener.
 */
export function buildPolicyApp(db: DB, config: PolicyAppConfig) {
    const app = createApiServer({ logger: config.logger });

    if (config.authToken !== undefined) {
        const expected = `Bearer ${config.authToken}`;
        app.addHook('preHandler', async (req) => {
            if (req.headers.authorization !== expected) {
                throw new UnauthorizedError();
            }
        });
    }

    const repos = new Repositories(db);
    const authorizationService = new AuthorizationService({ repos, multiOrgEnabled: config.multiOrgEnabled });
    const transactionClassifier = new TransactionClassifier(new TargetRpc(config.targetRpcUrl, 'zksync-os'));
    const cache = config.decisionCache ? new InMemoryDecisionCache(config.decisionCache) : undefined;
    const runtime: FeatureRuntime = {
        coreFacts: new RepositoriesCoreFacts({ repos }),
        pool: db.$client,
        metrics: metricsServer,
        logger: config.logger
    };
    const overlays = config.authorizationOverlays?.(runtime);
    const onAdmitDenied = config.onAdmitDenied?.(runtime);
    const admitService = new AdmitService({
        repos,
        authorizationService,
        transactionClassifier,
        logger: config.logger.child({ role: 'admit' }),
        protocolVersions: config.protocolVersions,
        cache,
        ...(overlays === undefined ? {} : { overlays })
    });
    const judgeService = new JudgeService({
        repos,
        authorizationService,
        transactionClassifier,
        logger: config.logger.child({ role: 'judge' }),
        protocolVersions: config.protocolVersions,
        cache,
        multiOrgEnabled: config.multiOrgEnabled,
        ...(overlays === undefined ? {} : { overlays })
    });

    app.register(admitRoutes, {
        admitService,
        protocolVersions: config.protocolVersions,
        ...(onAdmitDenied === undefined ? {} : { onAdmitDenied })
    });
    app.register(judgeRoutes, { judgeService, protocolVersions: config.protocolVersions });

    app.setErrorHandler(errorHandler);

    return app;
}

export type PolicyServer = ReturnType<typeof buildPolicyApp>;
