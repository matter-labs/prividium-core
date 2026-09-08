import { createHash } from 'node:crypto';
import { policyDecisionCacheCounter } from '../utils/metrics';
import type { AuthorizationResult } from './authorization-service';

/**
 * Read-through cache for `/admit` and `/judge` decisions. A decision is a pure
 * function of the request inputs and the policy state, so a cache hit returns
 * the prior result without re-evaluating against the DB.
 *
 * The win is structural, not workload-dependent: the sequencer evaluates the
 * same transaction at mempool inclusion and again at block building (plus once
 * at `estimateGas`), so the inclusion -> block-build repeat is a guaranteed hit
 * for every transaction.
 *
 * Invalidation is by TTL: entries live for at most their TTL, so a permission,
 * role, or wallet change takes effect once the relevant entries expire. The
 * protocol version is part of the key, so a protocol bump separates entries
 * automatically.
 */
export interface DecisionCacheStore {
    get(key: string): AuthorizationResult | undefined;
    set(key: string, result: AuthorizationResult): void;
}

/**
 * In-memory TTL cache with a hard entry cap (FIFO eviction). A single-replica
 * deployment gets the full inclusion -> block-build hit. With multiple replicas
 * the hit only lands when both calls reach the same replica; a shared backend
 * (e.g. a Postgres decisions table) implementing {@link DecisionCacheStore}
 * would be needed there.
 */
export class InMemoryDecisionCache implements DecisionCacheStore {
    private readonly entries = new Map<string, { result: AuthorizationResult; expiresAt: number }>();
    private readonly ttlMs: number;
    private readonly maxEntries: number;
    private readonly now: () => number;

    constructor(opts: { ttlMs: number; maxEntries: number; now?: () => number }) {
        this.ttlMs = opts.ttlMs;
        this.maxEntries = opts.maxEntries;
        this.now = opts.now ?? Date.now;
    }

    get(key: string): AuthorizationResult | undefined {
        const entry = this.entries.get(key);
        if (entry === undefined) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.result;
    }

    set(key: string, result: AuthorizationResult): void {
        // Evict the oldest entry (Map preserves insertion order) only when
        // adding a genuinely new key at capacity, so refreshing an existing key
        // never evicts an unrelated one.
        if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { result, expiresAt: this.now() + this.ttlMs });
    }
}

/** Stable cache key for a list of canonical key parts. */
export function decisionCacheKey(parts: readonly string[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * Read-through cache wrapper shared by `AdmitService.admit` and
 * `JudgeService.judge`. With no cache configured it just runs `evaluate`.
 * Otherwise it keys on `keyParts`, returns a hit, or evaluates and stores the
 * result, recording the hit/miss on {@link policyDecisionCacheCounter}. Only
 * successful evaluations are cached: an internal error throws out of `evaluate`
 * before `set`, so it stays fail-closed and uncached.
 */
export async function withDecisionCache(
    cache: DecisionCacheStore | undefined,
    route: 'admit' | 'judge',
    keyParts: readonly string[],
    evaluate: () => Promise<AuthorizationResult>
): Promise<AuthorizationResult> {
    if (cache === undefined) {
        return evaluate();
    }
    const key = decisionCacheKey(keyParts);
    const hit = cache.get(key);
    if (hit !== undefined) {
        policyDecisionCacheCounter.inc({ route, outcome: 'hit' });
        return hit;
    }
    policyDecisionCacheCounter.inc({ route, outcome: 'miss' });
    const result = await evaluate();
    cache.set(key, result);
    return result;
}
