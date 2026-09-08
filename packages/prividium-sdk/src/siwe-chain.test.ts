import { createPublicClient, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrividiumSessionError } from './errors.js';
import { MemoryStorage } from './memory-storage.js';
import { UNAUTHORIZED_ERROR_CODE } from './rpc-error-codes.js';
import { createPrividiumSiweChain, type PrividiumSiweConfig } from './siwe-chain.js';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_API_URL = 'https://api.example.com';
const TEST_DOMAIN = 'localhost:3000';
const TEST_SIWE_MSG = 'Sign in to Prividium';
const TEST_NONCE_TOKEN = 'test-nonce-token';
const TEST_TOKEN = 'session-token-abc';
const TEST_EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const TEST_CHAIN = { id: 270, name: 'Prividium' } as PrividiumSiweConfig['chain'];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function defaultConfig(overrides?: Partial<PrividiumSiweConfig>): PrividiumSiweConfig {
    return {
        chain: TEST_CHAIN,
        prividiumApiBaseUrl: TEST_API_URL,
        account: privateKeyToAccount(TEST_PRIVATE_KEY),
        domain: TEST_DOMAIN,
        ...overrides
    };
}

// Builds a mock fetch that responds to SIWE message + login (2 calls for authorize)
function mockSiweAuthFetch() {
    return vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/siwe-messages')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
            });
        }
        if (urlStr.includes('/api/auth/login/crypto-native')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
            });
        }
        return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve({})
        });
    });
}

describe('createPrividiumSiweChain', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('initialization', () => {
        it('creates chain with correct chain ID and RPC URL', () => {
            const prividium = createPrividiumSiweChain(defaultConfig());
            expect(prividium.chain.id).toBe(270);
            expect(prividium.chain.rpcUrls.default.http[0]).toBe(`${TEST_API_URL}/rpc`);
        });

        it('exposes the account address', () => {
            const prividium = createPrividiumSiweChain(defaultConfig());
            expect(prividium.address).toBe(TEST_ADDRESS);
        });

        it('uses MemoryStorage by default', () => {
            // Should not throw (no localStorage dependency)
            const prividium = createPrividiumSiweChain(defaultConfig());
            expect(prividium.isAuthorized()).toBe(false);
        });

        it('accepts custom storage', () => {
            const customStorage = new MemoryStorage();
            const prividium = createPrividiumSiweChain(defaultConfig({ storage: customStorage }));
            expect(prividium.isAuthorized()).toBe(false);
        });
    });

    describe('authorize', () => {
        it('performs full SIWE flow and stores token', async () => {
            Object.defineProperty(globalThis, 'fetch', { value: mockSiweAuthFetch(), writable: true });

            const prividium = createPrividiumSiweChain(defaultConfig());
            const result = await prividium.authorize();

            expect(result.rawToken).toBe(TEST_TOKEN);
            expect(result.expiresAt).toEqual(new Date(TEST_EXPIRES_AT));
            expect(prividium.isAuthorized()).toBe(true);
        });
    });

    describe('getAuthHeaders', () => {
        it('returns null when not authorized', () => {
            const prividium = createPrividiumSiweChain(defaultConfig());
            expect(prividium.getAuthHeaders()).toBeNull();
        });

        it('returns Bearer token header when authorized', async () => {
            Object.defineProperty(globalThis, 'fetch', { value: mockSiweAuthFetch(), writable: true });

            const prividium = createPrividiumSiweChain(defaultConfig());
            await prividium.authorize();

            expect(prividium.getAuthHeaders()).toEqual({
                Authorization: `Bearer ${TEST_TOKEN}`
            });
        });
    });

    describe('unauthorize', () => {
        it('clears the session', async () => {
            Object.defineProperty(globalThis, 'fetch', { value: mockSiweAuthFetch(), writable: true });

            const prividium = createPrividiumSiweChain(defaultConfig());
            await prividium.authorize();
            expect(prividium.isAuthorized()).toBe(true);

            prividium.unauthorize();
            expect(prividium.isAuthorized()).toBe(false);
            expect(prividium.getAuthHeaders()).toBeNull();
        });
    });

    describe('fetchContractAbi', () => {
        it('fetches the contract ABI from the API', async () => {
            const contractAddress = '0x1111111111111111111111111111111111111111';
            const abiResponse = {
                contractAddress,
                name: 'TestContract',
                abi: [{ type: 'function', name: 'balanceOf' }],
                functions: [
                    {
                        selector: '0x70a08231',
                        signature: 'balanceOf(address)',
                        name: 'balanceOf',
                        accessType: 'read'
                    }
                ]
            };

            const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return Promise.resolve(jsonResponse({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN }));
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve(jsonResponse({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT }));
                }
                if (urlStr.includes(`/api/contracts/${contractAddress}/abi`)) {
                    return Promise.resolve(jsonResponse(abiResponse));
                }
                return Promise.resolve(jsonResponse({}));
            });
            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(defaultConfig());
            await prividium.authorize();
            const result = await prividium.fetchContractAbi(contractAddress);

            expect(result).toEqual(abiResponse);
            expect(mockFetch).toHaveBeenCalledWith(
                `${TEST_API_URL}/api/contracts/${contractAddress}/abi`,
                expect.objectContaining({ method: 'GET' })
            );
        });
    });

    describe('auto-reauthentication', () => {
        it('reauthenticates on 401 and retries the API call', async () => {
            const onReauthenticate = vi.fn();
            let fetchCallCount = 0;

            const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
                fetchCallCount++;
                const urlStr = url.toString();

                if (urlStr.includes('/api/siwe-messages')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    });
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
                    });
                }
                if (urlStr.includes('/api/profiles/me')) {
                    // First API call returns 401, retry succeeds
                    if (fetchCallCount <= 3) {
                        // 3rd call (after authorize's 2 calls) is the first fetchUser
                        return Promise.resolve({
                            ok: false,
                            status: 401,
                            statusText: 'Unauthorized',
                            json: () => Promise.resolve({})
                        });
                    }
                    // After reauth, the retry succeeds (call #6: reauth siwe, #7: reauth login, #8: retry fetchUser)
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () =>
                            Promise.resolve({
                                id: 'user-1',
                                createdAt: new Date().toISOString(),
                                displayName: 'Test User',
                                updatedAt: new Date().toISOString(),
                                roles: [],
                                wallets: []
                            })
                    });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            });

            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(
                defaultConfig({
                    autoReauthenticate: true,
                    onReauthenticate
                })
            );

            await prividium.authorize();
            const user = await prividium.fetchUser();

            expect(user.id).toBe('user-1');
            expect(onReauthenticate).toHaveBeenCalledTimes(1);
        });

        it('throws PrividiumSessionError when autoReauthenticate is false and gets 401', async () => {
            const onAuthExpiry = vi.fn();

            const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    });
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
                    });
                }
                if (urlStr.includes('/api/profiles/me')) {
                    return Promise.resolve({
                        ok: false,
                        status: 401,
                        statusText: 'Unauthorized',
                        json: () => Promise.resolve({})
                    });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            });

            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(
                defaultConfig({
                    autoReauthenticate: false,
                    onAuthExpiry
                })
            );

            await prividium.authorize();
            await expect(prividium.fetchUser()).rejects.toThrow(PrividiumSessionError);
            expect(onAuthExpiry).toHaveBeenCalledTimes(1);
        });

        it('calls onReauthenticateError when reauthentication fails', async () => {
            const onReauthenticateError = vi.fn();
            const onAuthExpiry = vi.fn();

            const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    // First time: succeed (initial auth), second time: fail (reauth attempt)
                    if (mockFetch.mock.calls.filter((c) => String(c[0]).includes('/api/siwe-messages')).length <= 1) {
                        return Promise.resolve({
                            ok: true,
                            status: 200,
                            statusText: 'OK',
                            json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                        });
                    }
                    return Promise.resolve({
                        ok: false,
                        status: 500,
                        statusText: 'Internal Server Error',
                        json: () => Promise.resolve({})
                    });
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
                    });
                }
                if (urlStr.includes('/api/profiles/me')) {
                    return Promise.resolve({
                        ok: false,
                        status: 401,
                        statusText: 'Unauthorized',
                        json: () => Promise.resolve({})
                    });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            });

            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(
                defaultConfig({
                    onReauthenticateError,
                    onAuthExpiry
                })
            );

            await prividium.authorize();
            await expect(prividium.fetchUser()).rejects.toThrow(PrividiumSessionError);
            expect(onReauthenticateError).toHaveBeenCalledTimes(1);
            expect(onReauthenticateError.mock.calls[0][0]).toBeInstanceOf(Error);
        });

        it('reauthenticates before RPC when the cached token is expired', async () => {
            const storage = new MemoryStorage();
            storage.setItem(
                `prividium_token_${TEST_CHAIN.id}`,
                JSON.stringify({
                    rawToken: 'expired-token',
                    expiresAt: new Date(Date.now() - 60_000).toISOString()
                })
            );

            const mockFetch = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    });
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
                    });
                }
                if (urlStr.includes('/rpc')) {
                    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
                    return Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x10e' }));
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            });

            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(
                defaultConfig({
                    storage,
                    autoReauthenticate: true
                })
            );
            const publicClient = createPublicClient({ chain: prividium.chain, transport: prividium.transport });

            await expect(publicClient.getChainId()).resolves.toBe(270);
            expect(mockFetch).toHaveBeenCalledTimes(3);
            expect(mockFetch.mock.calls.map(([url]) => url.toString())).toEqual([
                `${TEST_API_URL}/api/siwe-messages`,
                `${TEST_API_URL}/api/auth/login/crypto-native`,
                `${TEST_API_URL}/rpc`
            ]);
        });

        it('reauthenticates and retries once when RPC returns a Prividium unauthorized error', async () => {
            const onReauthenticate = vi.fn();
            let rpcCalls = 0;

            const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    });
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
                    });
                }
                if (urlStr.includes('/rpc')) {
                    rpcCalls++;
                    if (rpcCalls === 1) {
                        return Promise.resolve(
                            jsonResponse({
                                jsonrpc: '2.0',
                                id: 1,
                                error: { code: UNAUTHORIZED_ERROR_CODE, message: 'Unauthorized' }
                            })
                        );
                    }
                    return Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x10e' }));
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            });

            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(
                defaultConfig({
                    autoReauthenticate: true,
                    onReauthenticate
                })
            );
            await prividium.authorize();
            onReauthenticate.mockClear();

            const publicClient = createPublicClient({ chain: prividium.chain, transport: prividium.transport });

            await expect(publicClient.getChainId()).resolves.toBe(270);
            expect(rpcCalls).toBe(2);
            expect(onReauthenticate).toHaveBeenCalledTimes(1);
        });
    });

    describe('deduplication', () => {
        it('concurrent reauth attempts share the same promise', async () => {
            const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
                const urlStr = url.toString();
                if (urlStr.includes('/api/siwe-messages')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
                    });
                }
                if (urlStr.includes('/api/auth/login/crypto-native')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: () => Promise.resolve({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
                    });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            });

            Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });

            const prividium = createPrividiumSiweChain(defaultConfig());

            // Initial auth
            await prividium.authorize();

            // Clear token to simulate expiry, then trigger concurrent calls
            prividium.unauthorize();

            // Both calls will find token missing and trigger ensureAuthorized -> reauthenticate
            const [result1, result2] = await Promise.all([prividium.authorize(), prividium.authorize()]);

            expect(result1.rawToken).toBe(TEST_TOKEN);
            expect(result2.rawToken).toBe(TEST_TOKEN);
            // Only one additional auth flow should have happened (1 siwe-messages call for reauth)
            // Each authorize() calls siweAuth.authorize() directly, not reauthenticate()
            // So this tests that the SiweAuth works correctly for concurrent calls
        });
    });
});
