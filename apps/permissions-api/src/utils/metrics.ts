import { HTTP_REQUEST_DURATION_BUCKETS, MetricsServer } from '@repo/api-metrics';

export const metricsServer = new MetricsServer('prividium-api');

export const httpRequestCounter = metricsServer.counter('http_requests_total', 'Total number of HTTP requests', [
    'method',
    'route',
    'status_code',
    'role',
    'result'
]);

export const httpRequestDuration = metricsServer.histogram(
    'http_request_duration_seconds',
    'Duration of HTTP requests in seconds',
    ['method', 'route', 'status_code', 'role', 'result'],
    HTTP_REQUEST_DURATION_BUCKETS
);

export const jsonPrcRequestCounter = metricsServer.counter(
    'json_rpc_requests_total',
    'Total number of JSON-RPC requests',
    ['method', 'rpcMethod', 'status_code', 'role', 'result']
);

export const jsonPrcRequestDuration = metricsServer.histogram(
    'json_rpc_request_duration_seconds',
    'Duration of JSON-RPC requests in seconds',
    ['method', 'rpcMethod', 'status_code', 'role', 'result'],
    HTTP_REQUEST_DURATION_BUCKETS
);

export const orgCountGauge = metricsServer.gauge('prividium_org_count', 'Current number of non-deleted organizations');

export const orgQuotaLimitGauge = metricsServer.gauge(
    'prividium_org_quota_limit',
    'Configured maximum number of organizations (MAX_ORGANIZATIONS)'
);

export const multiOrgEnabledGauge = metricsServer.gauge(
    'prividium_multi_org_enabled',
    'Whether organization isolation is enabled (MULTI_ORG_ENABLED)'
);

export const policyListenerEnabledGauge = metricsServer.gauge(
    'prividium_policy_listener_enabled',
    'Whether the /admit and /judge listener is mounted (POLICY_PORT set)'
);

// No rate here while prividium_multi_org_enabled is 1 means the sequencer never
// calls the listener, which a boot check cannot detect.
export const policyDecisionCounter = metricsServer.counter(
    'prividium_policy_decisions_total',
    'Policy decisions returned by /admit and /judge',
    ['route', 'decision', 'rule_id']
);

export const policyDecisionCacheCounter = metricsServer.counter(
    'policy_decision_cache_total',
    'Policy decision cache lookups by route and outcome (hit/miss)',
    ['route', 'outcome']
);
