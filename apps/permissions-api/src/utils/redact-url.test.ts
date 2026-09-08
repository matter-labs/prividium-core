import { describe, expect, it } from 'vitest';
import { redactSensitiveUrl } from './redact-url';

describe('redactSensitiveUrl', () => {
    it('redacts /rpc/wallet/:token paths', () => {
        expect(redactSensitiveUrl('/rpc/wallet/secret-abc123')).toBe('/rpc/wallet/[REDACTED]');
    });

    it('preserves query parameters', () => {
        expect(redactSensitiveUrl('/rpc/wallet/token?foo=bar')).toBe('/rpc/wallet/[REDACTED]?foo=bar');
    });

    it('does not modify non-wallet URLs', () => {
        expect(redactSensitiveUrl('/api/users')).toBe('/api/users');
        expect(redactSensitiveUrl('/rpc')).toBe('/rpc');
        expect(redactSensitiveUrl('/rpc/service')).toBe('/rpc/service');
    });

    it('handles empty string', () => {
        expect(redactSensitiveUrl('')).toBe('');
    });
});
