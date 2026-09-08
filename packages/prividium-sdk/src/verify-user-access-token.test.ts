import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyUserAccessToken } from './verify-user-access-token.js';

const TEST_API_URL = 'https://api.example.com';

function mockFetch(handler: (url: string, init?: RequestInit) => unknown | Promise<unknown>) {
    return vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => handler(url.toString(), init));
}

describe('verifyUserAccessToken', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns { valid: true, userId } when /api/profiles/me returns a profile', async () => {
        const seenInits: RequestInit[] = [];
        const fetchMock = mockFetch((url, init) => {
            if (url === `${TEST_API_URL}/api/profiles/me`) {
                if (init) seenInits.push(init);
                return { ok: true, status: 200, json: async () => ({ id: 'user-42' }) };
            }
            return { ok: false, status: 404 };
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const result = await verifyUserAccessToken('raw-token', { apiUrl: TEST_API_URL });
        expect(result).toEqual({ valid: true, userId: 'user-42' });
        expect(new Headers(seenInits[0]?.headers).get('Authorization')).toBe('Bearer raw-token');
    });

    it('normalises a trailing slash on apiUrl when composing the request URL', async () => {
        const seenUrls: string[] = [];
        const fetchMock = mockFetch((url) => {
            seenUrls.push(url);
            return { ok: true, status: 200, json: async () => ({ id: 'u' }) };
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        await verifyUserAccessToken('token', { apiUrl: `${TEST_API_URL}/` });
        expect(seenUrls[0]).toBe(`${TEST_API_URL}/api/profiles/me`);
    });

    it('does not double-prefix a token already starting with "Bearer "', async () => {
        const seenInits: RequestInit[] = [];
        const fetchMock = mockFetch((_url, init) => {
            if (init) seenInits.push(init);
            return { ok: true, status: 200, json: async () => ({ id: 'u' }) };
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        await verifyUserAccessToken('Bearer my-token', { apiUrl: TEST_API_URL });
        expect(new Headers(seenInits[0]?.headers).get('Authorization')).toBe('Bearer my-token');
    });

    it('returns invalid_token on 401', async () => {
        const fetchMock = mockFetch(() => ({ ok: false, status: 401 }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const result = await verifyUserAccessToken('token', { apiUrl: TEST_API_URL });
        expect(result).toEqual({ valid: false, error: 'invalid_token' });
    });

    it('returns invalid_token on 403', async () => {
        const fetchMock = mockFetch(() => ({ ok: false, status: 403 }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const result = await verifyUserAccessToken('token', { apiUrl: TEST_API_URL });
        expect(result).toEqual({ valid: false, error: 'invalid_token' });
    });

    it('returns server_error on 500', async () => {
        const fetchMock = mockFetch(() => ({ ok: false, status: 500 }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const result = await verifyUserAccessToken('token', { apiUrl: TEST_API_URL });
        expect(result).toEqual({ valid: false, error: 'server_error' });
    });

    it('returns network_error when fetch throws and preserves the underlying error via cause + onError', async () => {
        const underlying = new TypeError('fetch failed');
        const fetchMock = vi.fn().mockRejectedValue(underlying);
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const onError = vi.fn();
        const result = await verifyUserAccessToken('token', { apiUrl: TEST_API_URL, onError });
        expect(result).toEqual({ valid: false, error: 'network_error', cause: underlying });
        expect(onError).toHaveBeenCalledWith(underlying);
    });

    it('returns server_error if response.json() throws and preserves the underlying error', async () => {
        const underlying = new SyntaxError('bad json');
        const fetchMock = mockFetch(() => ({
            ok: true,
            status: 200,
            json: async () => {
                throw underlying;
            }
        }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const onError = vi.fn();
        const result = await verifyUserAccessToken('token', { apiUrl: TEST_API_URL, onError });
        expect(result).toEqual({ valid: false, error: 'server_error', cause: underlying });
        expect(onError).toHaveBeenCalledWith(underlying);
    });

    it('returns invalid_token if profile has no id', async () => {
        const fetchMock = mockFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const result = await verifyUserAccessToken('token', { apiUrl: TEST_API_URL });
        expect(result).toEqual({ valid: false, error: 'invalid_token' });
    });
});
