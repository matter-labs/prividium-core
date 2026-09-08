import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './memory-storage.js';
import { SiweAuth, type SiweAuthConfig } from './siwe-auth.js';
import { TokenManager } from './storage.js';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_DOMAIN = 'localhost:3000';
const TEST_API_URL = 'https://api.example.com';
const TEST_SIWE_MSG = 'Sign in to Prividium with Ethereum';
const TEST_NONCE_TOKEN = 'test-nonce-token';
const TEST_TOKEN = 'session-token-123';
const TEST_EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

function createConfig(overrides?: Partial<SiweAuthConfig>): SiweAuthConfig {
    const storage = new MemoryStorage();
    const tokenManager = new TokenManager(storage, 270, TEST_API_URL);
    return {
        account: privateKeyToAccount(TEST_PRIVATE_KEY),
        prividiumApiBaseUrl: TEST_API_URL,
        domain: TEST_DOMAIN,
        tokenManager,
        ...overrides
    };
}

function mockFetchResponses(...responses: Array<{ ok: boolean; status: number; json: unknown }>) {
    const mockFetch = vi.fn();
    for (const resp of responses) {
        const body = JSON.stringify(resp.json);
        mockFetch.mockResolvedValueOnce({
            ok: resp.ok,
            status: resp.status,
            statusText: resp.ok ? 'OK' : 'Error',
            json: () => Promise.resolve(resp.json),
            clone() {
                return { text: () => Promise.resolve(body) };
            }
        });
    }
    Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true });
    return mockFetch;
}

describe('SiweAuth', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('address', () => {
        it('returns the address derived from the account', () => {
            const auth = new SiweAuth(createConfig());
            expect(auth.address).toBe(TEST_ADDRESS);
        });
    });

    describe('authorize', () => {
        it('performs full SIWE flow: request message, sign, login, store token', async () => {
            const config = createConfig();
            const setTokenDirectSpy = vi.spyOn(config.tokenManager, 'setTokenDirect');

            const mockFetch = mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                { ok: true, status: 200, json: { token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT } }
            );

            const auth = new SiweAuth(config);
            const result = await auth.authorize();

            // Verify SIWE message request
            expect(mockFetch).toHaveBeenCalledTimes(2);
            const [siweUrl, siweOpts] = mockFetch.mock.calls[0];
            expect(siweUrl).toEqual(new URL(`${TEST_API_URL}/api/siwe-messages`));
            expect(JSON.parse(siweOpts.body)).toEqual({
                address: TEST_ADDRESS,
                domain: TEST_DOMAIN
            });

            // Verify login request
            const [loginUrl, loginOpts] = mockFetch.mock.calls[1];
            expect(loginUrl).toEqual(new URL(`${TEST_API_URL}/api/auth/login/crypto-native`));
            const loginBody = JSON.parse(loginOpts.body);
            expect(loginBody.message).toBe(TEST_SIWE_MSG);
            expect(loginBody.signature).toBeDefined();
            expect(loginBody.nonceToken).toBe(TEST_NONCE_TOKEN);
            expect(typeof loginBody.signature).toBe('string');
            expect(loginBody.signature.startsWith('0x')).toBe(true);

            // Verify token stored — renewableUntil falls back to expiresAt when omitted by API
            expect(setTokenDirectSpy).toHaveBeenCalledWith({
                rawToken: TEST_TOKEN,
                expiresAt: new Date(TEST_EXPIRES_AT),
                renewableUntil: new Date(TEST_EXPIRES_AT)
            });

            // Verify return value
            expect(result.rawToken).toBe(TEST_TOKEN);
            expect(result.expiresAt).toEqual(new Date(TEST_EXPIRES_AT));
        });

        it('omits domain from request body when not configured', async () => {
            const config = createConfig({ domain: undefined });

            const mockFetch = mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                { ok: true, status: 200, json: { token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT } }
            );

            const auth = new SiweAuth(config);
            await auth.authorize();

            const [, siweOpts] = mockFetch.mock.calls[0];
            const body = JSON.parse(siweOpts.body);
            expect(body).toEqual({ address: TEST_ADDRESS });
            expect(body).not.toHaveProperty('domain');
        });

        it('throws when SIWE message request fails', async () => {
            mockFetchResponses({ ok: false, status: 500, json: {} });

            const auth = new SiweAuth(createConfig());
            await expect(auth.authorize()).rejects.toThrow('Failed to get SIWE message: 500 Error: {}');
        });

        it('throws when login request fails', async () => {
            mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                { ok: false, status: 401, json: {} }
            );

            const auth = new SiweAuth(createConfig());
            await expect(auth.authorize()).rejects.toThrow('SIWE login failed: 401 Error: {}');
        });

        it('includes server error detail when SIWE message request fails', async () => {
            mockFetchResponses({
                ok: false,
                status: 404,
                json: {
                    error: { code: 'NOT_FOUND', message: 'User with walletAddress "0xabc" not found' }
                }
            });

            const auth = new SiweAuth(createConfig());
            await expect(auth.authorize()).rejects.toThrow(
                'Failed to get SIWE message: 404 Error: User with walletAddress "0xabc" not found (NOT_FOUND)'
            );
        });

        it('includes server error detail when login request fails', async () => {
            mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                {
                    ok: false,
                    status: 401,
                    json: { error: { code: 'UNAUTHORIZED_ERROR', message: 'Nonce was already used' } }
                }
            );

            const auth = new SiweAuth(createConfig());
            await expect(auth.authorize()).rejects.toThrow(
                'SIWE login failed: 401 Error: Nonce was already used (UNAUTHORIZED_ERROR)'
            );
        });

        it('throws when MFA is required', async () => {
            mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                {
                    ok: true,
                    status: 200,
                    json: { requiresMfa: true, challenge: 'abc', rpId: 'example.com', allowCredentials: [] }
                }
            );

            const auth = new SiweAuth(createConfig());
            await expect(auth.authorize()).rejects.toThrow(
                'SIWE login requires MFA which is not supported in programmatic auth'
            );
        });
    });

    describe('unauthorize', () => {
        it('clears the token via tokenManager', async () => {
            const config = createConfig();
            mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                { ok: true, status: 200, json: { token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT } }
            );

            const auth = new SiweAuth(config);
            await auth.authorize();
            expect(config.tokenManager.isAuthorized()).toBe(true);

            auth.unauthorize();
            expect(config.tokenManager.isAuthorized()).toBe(false);
        });
    });

    describe('isAuthorized', () => {
        it('returns false when no token is stored', () => {
            const auth = new SiweAuth(createConfig());
            expect(auth.isAuthorized()).toBe(false);
        });

        it('returns true after successful authorize', async () => {
            mockFetchResponses(
                { ok: true, status: 200, json: { msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN } },
                { ok: true, status: 200, json: { token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT } }
            );

            const config = createConfig();
            const auth = new SiweAuth(config);
            await auth.authorize();
            expect(auth.isAuthorized()).toBe(true);
        });
    });
});
