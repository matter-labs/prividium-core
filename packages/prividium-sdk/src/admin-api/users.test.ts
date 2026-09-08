import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrividiumSiweChain, type PrividiumSiweConfig } from '../siwe-chain.js';
import type { AdminUserUpdateInput } from './types.js';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_API_URL = 'https://api.example.com';
const TEST_DOMAIN = 'localhost:3000';
const TEST_SIWE_MSG = 'Sign in to Prividium';
const TEST_NONCE_TOKEN = 'test-nonce-token';
const TEST_TOKEN = 'session-token-abc';
const TEST_EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const TEST_CHAIN = { id: 270, name: 'Prividium' } as PrividiumSiweConfig['chain'];

const sampleUser = {
    id: 'user-1',
    displayName: 'Alice',
    source: 'crypto_native' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    organization: null,
    roles: [{ id: 'role-admin', roleName: 'admin' }],
    wallets: [
        {
            id: 1,
            walletAddress: '0xabc',
            userId: 'user-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }
    ]
};

function defaultConfig(overrides?: Partial<PrividiumSiweConfig>): PrividiumSiweConfig {
    return {
        chain: TEST_CHAIN,
        prividiumApiBaseUrl: TEST_API_URL,
        account: privateKeyToAccount(TEST_PRIVATE_KEY),
        domain: TEST_DOMAIN,
        ...overrides
    };
}

function mockApiFetch(responder: (url: string, init?: RequestInit) => unknown | Promise<unknown>) {
    return vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/siwe-messages')) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
            };
        }
        if (urlStr.includes('/api/auth/login/crypto-native')) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
            };
        }
        const result = await responder(urlStr, init);
        return result;
    });
}

describe('chain.admin.users', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getById', () => {
        it('sends a GET to /api/users/:id with Bearer auth header and parses the response', async () => {
            const seenInits: RequestInit[] = [];
            const fetchMock = mockApiFetch((url, init) => {
                if (url.includes('/api/users/user-1')) {
                    if (init) seenInits.push(init);
                    return { ok: true, status: 200, statusText: 'OK', json: async () => sampleUser };
                }
                return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            const user = await sdk.admin.users.getById('user-1');
            expect(user.id).toBe('user-1');
            expect(user.wallets).toHaveLength(1);
            expect(user.wallets[0]?.walletAddress).toBe('0xabc');

            const lastInit = seenInits.at(-1);
            expect(lastInit?.method).toBe('GET');
            expect(new Headers(lastInit?.headers).get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
        });

        it('encodes special characters in the user id path segment', async () => {
            const seenUrls: string[] = [];
            const fetchMock = mockApiFetch((url) => {
                if (url.includes('/api/users/')) {
                    seenUrls.push(url);
                    return { ok: true, status: 200, statusText: 'OK', json: async () => sampleUser };
                }
                return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();
            await sdk.admin.users.getById('a/b?c');

            expect(seenUrls.at(-1)).toBe(`${TEST_API_URL}/api/users/a%2Fb%3Fc`);
        });

        it('throws on non-OK response', async () => {
            const fetchMock = mockApiFetch((url) => {
                if (url.includes('/api/users/missing')) {
                    return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'not found' };
                }
                return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            await expect(sdk.admin.users.getById('missing')).rejects.toThrow(/Error calling/);
        });
    });

    describe('update', () => {
        it('sends a complete update directly as a single PUT (no extra fetch)', async () => {
            const seenBodies: string[] = [];
            const seenMethods: string[] = [];
            const fetchMock = mockApiFetch((url, init) => {
                if (url.includes('/api/users/user-1')) {
                    if (init?.method) seenMethods.push(init.method);
                    if (typeof init?.body === 'string') seenBodies.push(init.body);
                    return { ok: true, status: 200, statusText: 'OK', json: async () => sampleUser };
                }
                return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            const updated = await sdk.admin.users.update('user-1', {
                displayName: 'Ada',
                roles: [{ id: 'admin' }],
                wallets: ['0xabc', '0xdef']
            });
            expect(updated.id).toBe('user-1');
            // All fields supplied: no GET needed, only the PUT.
            expect(seenMethods).toEqual(['PUT']);
            // Role references collapse to bare ids on the wire.
            expect(JSON.parse(seenBodies.at(-1) ?? '{}')).toEqual({
                displayName: 'Ada',
                roles: ['admin'],
                wallets: ['0xabc', '0xdef']
            });
        });

        it('rejects bare role strings at compile time — roles takes { id } references, not names', () => {
            // Guards the surrogate-id contract: passing role names/ids as bare strings (the pre-id
            // shape) must not type-check, so the "names vs ids" mistake fails at build, not silently
            // at runtime. If roles is ever loosened back to string[], @ts-expect-error stops firing
            // and this line becomes a typecheck error.
            // @ts-expect-error bare strings are not assignable to Array<{ id: string }>
            const bad: AdminUserUpdateInput = { roles: ['admin'] };
            expect(bad).toBeDefined();
        });

        it('preserves omitted fields by fetching the current user and merging before the PUT', async () => {
            const seenBodies: string[] = [];
            const seenMethods: string[] = [];
            const fetchMock = mockApiFetch((url, init) => {
                if (url.includes('/api/users/user-1')) {
                    if (init?.method) seenMethods.push(init.method);
                    if (typeof init?.body === 'string') seenBodies.push(init.body);
                    return { ok: true, status: 200, statusText: 'OK', json: async () => sampleUser };
                }
                return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            // Partial input (wallets only): the SDK fetches the current user first,
            // then PUTs a full body with displayName/roles taken from the existing record.
            const updated = await sdk.admin.users.update('user-1', { wallets: ['0xabc', '0xdef'] });
            expect(updated.id).toBe('user-1');
            expect(seenMethods).toEqual(['GET', 'PUT']);
            expect(JSON.parse(seenBodies.at(-1) ?? '{}')).toEqual({
                displayName: 'Alice',
                roles: ['role-admin'],
                wallets: ['0xabc', '0xdef']
            });
        });
    });

    describe('reauth on 401', () => {
        it('getById retries after 401 with refreshed bearer + preserves the path', async () => {
            const onReauthenticate = vi.fn();
            let userCallCount = 0;
            const seenAuthHeaders: Array<string | null> = [];

            const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: async () => ({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    };
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: async () => ({ token: `${TEST_TOKEN}-${++userCallCount}`, expiresAt: TEST_EXPIRES_AT })
                    };
                }
                if (urlStr.endsWith('/api/users/user-1')) {
                    seenAuthHeaders.push(new Headers(init?.headers).get('Authorization'));
                    if (seenAuthHeaders.length === 1) {
                        return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) };
                    }
                    return { ok: true, status: 200, statusText: 'OK', json: async () => sampleUser };
                }
                throw new Error(`unexpected fetch: ${urlStr}`);
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig({ onReauthenticate }));
            await sdk.authorize();

            const user = await sdk.admin.users.getById('user-1');
            expect(user.id).toBe('user-1');
            expect(seenAuthHeaders).toHaveLength(2);
            expect(seenAuthHeaders[0]).not.toEqual(seenAuthHeaders[1]);
            expect(onReauthenticate).toHaveBeenCalledTimes(1);
        });

        it('update retries after 401 and preserves the JSON body on retry', async () => {
            let userCallCount = 0;
            const seenBodies: string[] = [];

            const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: async () => ({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    };
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: async () => ({ token: `${TEST_TOKEN}-${++userCallCount}`, expiresAt: TEST_EXPIRES_AT })
                    };
                }
                if (urlStr.endsWith('/api/users/user-1')) {
                    if (typeof init?.body === 'string') seenBodies.push(init.body);
                    if (seenBodies.length === 1) {
                        return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) };
                    }
                    return { ok: true, status: 200, statusText: 'OK', json: async () => sampleUser };
                }
                throw new Error(`unexpected fetch: ${urlStr}`);
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            await sdk.admin.users.update('user-1', {
                displayName: 'Ada',
                roles: [{ id: 'admin' }],
                wallets: ['0xabc']
            });
            expect(seenBodies).toHaveLength(2);
            expect(JSON.parse(seenBodies[0] ?? '{}')).toEqual({
                displayName: 'Ada',
                roles: ['admin'],
                wallets: ['0xabc']
            });
            expect(JSON.parse(seenBodies[1] ?? '{}')).toEqual({
                displayName: 'Ada',
                roles: ['admin'],
                wallets: ['0xabc']
            });
        });
    });

    describe('legacy server compatibility', () => {
        // A server that predates surrogate role ids returns roles without an `id` (name-keyed).
        const legacySampleUser = { ...sampleUser, roles: [{ roleName: 'admin' }] };

        it('accepts a response without role ids and uses the role name as the id', async () => {
            const fetchMock = mockApiFetch((url) =>
                url.includes('/api/users/user-1')
                    ? { ok: true, status: 200, statusText: 'OK', json: async () => legacySampleUser }
                    : { ok: true, status: 200, statusText: 'OK', json: async () => ({}) }
            );
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            const user = await sdk.admin.users.getById('user-1');
            expect(user.roles).toEqual([{ id: 'admin', roleName: 'admin' }]);
        });

        it('writes role names back to a legacy server', async () => {
            const seenBodies: string[] = [];
            const fetchMock = mockApiFetch((url, init) => {
                if (url.includes('/api/users/user-1')) {
                    if (typeof init?.body === 'string') seenBodies.push(init.body);
                    return { ok: true, status: 200, statusText: 'OK', json: async () => legacySampleUser };
                }
                return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
            });
            Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

            const sdk = createPrividiumSiweChain(defaultConfig());
            await sdk.authorize();

            // Partial update: the SDK fetches the current (legacy) user and merges. The role name it read
            // is what it must send back, since that server keys roles by name.
            await sdk.admin.users.update('user-1', { wallets: ['0xabc'] });
            expect(JSON.parse(seenBodies.at(-1) ?? '{}').roles).toEqual(['admin']);
        });
    });
});
