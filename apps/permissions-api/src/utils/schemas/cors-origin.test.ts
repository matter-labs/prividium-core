import { describe, expect, it } from 'vitest';
import { CorsOriginSchema } from './cors-origin';

describe('CorsOriginSchema', () => {
    describe('valid origins', () => {
        it('should accept an https origin', () => {
            const result = CorsOriginSchema.safeParse('https://example.com');
            expect(result.success).toBe(true);
            expect(result.data).toBe('https://example.com');
        });

        it('should accept an http origin', () => {
            const result = CorsOriginSchema.safeParse('http://example.com');
            expect(result.success).toBe(true);
            expect(result.data).toBe('http://example.com');
        });

        it('should accept an origin with an explicit port', () => {
            const result = CorsOriginSchema.safeParse('http://localhost:3000');
            expect(result.success).toBe(true);
            expect(result.data).toBe('http://localhost:3000');
        });

        it('should accept a subdomain origin', () => {
            const result = CorsOriginSchema.safeParse('https://app.example.com');
            expect(result.success).toBe(true);
            expect(result.data).toBe('https://app.example.com');
        });
    });

    describe('invalid protocols', () => {
        it('should reject ftp', () => {
            const result = CorsOriginSchema.safeParse('ftp://example.com');
            expect(result.success).toBe(false);
        });

        it('should reject a value without a scheme', () => {
            const result = CorsOriginSchema.safeParse('example.com');
            expect(result.success).toBe(false);
        });

        it('should reject an empty string', () => {
            const result = CorsOriginSchema.safeParse('');
            expect(result.success).toBe(false);
        });
    });

    describe('credentials', () => {
        it('should reject an origin with a username', () => {
            const result = CorsOriginSchema.safeParse('https://user@example.com');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe('Origin must not contain username or password');
        });

        it('should reject an origin with username and password', () => {
            const result = CorsOriginSchema.safeParse('https://user:pass@example.com');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe('Origin must not contain username or password');
        });
    });

    describe('wildcards', () => {
        it('should reject a literal wildcard in the hostname', () => {
            const result = CorsOriginSchema.safeParse('https://*.example.com');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe('Wildcards are not allowed in origins');
        });

        it('should reject a percent-encoded wildcard in the hostname', () => {
            const result = CorsOriginSchema.safeParse('https://%2A.example.com');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe('Wildcards are not allowed in origins');
        });
    });

    describe('non-canonical origins', () => {
        it('should reject an origin with a path', () => {
            const result = CorsOriginSchema.safeParse('https://example.com/path');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be normalized and not contain path, query, or fragment'
            );
        });

        it('should reject an origin with a query string', () => {
            const result = CorsOriginSchema.safeParse('https://example.com?foo=bar');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be normalized and not contain path, query, or fragment'
            );
        });

        it('should reject an origin with a fragment', () => {
            const result = CorsOriginSchema.safeParse('https://example.com#section');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be normalized and not contain path, query, or fragment'
            );
        });

        it('should reject an origin with a trailing slash', () => {
            const result = CorsOriginSchema.safeParse('https://example.com/');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be normalized and not contain path, query, or fragment'
            );
        });

        it('should reject a default port that is not part of the canonical origin', () => {
            const result = CorsOriginSchema.safeParse('https://example.com:443');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be normalized and not contain path, query, or fragment'
            );
        });
    });

    describe('commas / multi-value', () => {
        it('should reject a comma-separated list of origins', () => {
            const result = CorsOriginSchema.safeParse('https://a.com,https://b.com');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be a single origin; commas and lists are not allowed'
            );
        });

        it('should reject the mangled single-hostname form a comma produces', () => {
            const result = CorsOriginSchema.safeParse('https://a.com,https');
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Origin must be a single origin; commas and lists are not allowed'
            );
        });
    });

    describe('non-string inputs', () => {
        it('should reject null', () => {
            const result = CorsOriginSchema.safeParse(null);
            expect(result.success).toBe(false);
        });

        it('should reject undefined', () => {
            const result = CorsOriginSchema.safeParse(undefined);
            expect(result.success).toBe(false);
        });

        it('should reject a number', () => {
            const result = CorsOriginSchema.safeParse(123);
            expect(result.success).toBe(false);
        });
    });
});
