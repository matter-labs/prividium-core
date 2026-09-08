import { describe, expect, it } from 'vitest';
import type { AuthorizationResult } from './authorization-service';
import { decisionCacheKey, InMemoryDecisionCache } from './decision-cache';

const allow: AuthorizationResult = { authorized: true, ruleId: 'judge.allow' };
const deny: AuthorizationResult = { authorized: false, ruleId: 'permission.missing' };

describe('InMemoryDecisionCache', () => {
    it('returns a stored entry before its TTL and undefined once expired', () => {
        let t = 1000;
        const cache = new InMemoryDecisionCache({ ttlMs: 100, maxEntries: 10, now: () => t });
        cache.set('k', allow);
        expect(cache.get('k')).toEqual(allow);
        t = 1099;
        expect(cache.get('k')).toEqual(allow);
        t = 1100; // expiresAt (1000 + 100) <= now -> expired
        expect(cache.get('k')).toBeUndefined();
    });

    it('caches deny results too', () => {
        const cache = new InMemoryDecisionCache({ ttlMs: 1000, maxEntries: 10, now: () => 0 });
        cache.set('k', deny);
        expect(cache.get('k')).toEqual(deny);
    });

    it('evicts the oldest entry (FIFO) at capacity', () => {
        const cache = new InMemoryDecisionCache({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
        cache.set('a', allow);
        cache.set('b', deny);
        cache.set('c', allow); // over capacity -> evict 'a'
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toEqual(deny);
        expect(cache.get('c')).toEqual(allow);
    });

    it('refreshing an existing key at capacity does not evict another key', () => {
        const cache = new InMemoryDecisionCache({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
        cache.set('a', allow);
        cache.set('b', deny);
        cache.set('a', deny); // update in place, no eviction
        expect(cache.get('a')).toEqual(deny);
        expect(cache.get('b')).toEqual(deny);
    });
});

describe('decisionCacheKey', () => {
    it('is stable for the same parts and sensitive to order', () => {
        expect(decisionCacheKey(['a', 'b'])).toBe(decisionCacheKey(['a', 'b']));
        expect(decisionCacheKey(['a', 'b'])).not.toBe(decisionCacheKey(['b', 'a']));
    });
});
