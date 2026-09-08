import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorage, TokenManager } from './storage.js';
import { minutesInTheFuture, mockSessionResponse } from './test-utils.ts';
import { STORAGE_KEYS } from './types.js';

// Mock localStorage
const mockLocalStorage = {
    store: new Map<string, string>(),
    getItem: vi.fn((key: string) => mockLocalStorage.store.get(key) || null),
    setItem: vi.fn((key: string, value: string) => mockLocalStorage.store.set(key, value)),
    removeItem: vi.fn((key: string) => mockLocalStorage.store.delete(key)),
    test: () => true
};

// Mock global localStorage
Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true
});

// Helper to create valid token
function createTestToken(): string {
    return 'asd123';
}

describe('LocalStorage', () => {
    let storage: LocalStorage;

    beforeEach(() => {
        mockLocalStorage.store.clear();
        vi.clearAllMocks();
        storage = new LocalStorage();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should get item from localStorage', () => {
        mockLocalStorage.store.set('test', 'value');

        const result = storage.getItem('test');

        expect(result).toBe('value');
        expect(mockLocalStorage.getItem).toHaveBeenCalledWith('test');
    });

    it('should set item to localStorage', () => {
        storage.setItem('test', 'value');

        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('test', 'value');
        expect(mockLocalStorage.store.get('test')).toBe('value');
    });

    it('should remove item from localStorage', () => {
        mockLocalStorage.store.set('test', 'value');

        storage.removeItem('test');

        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('test');
        expect(mockLocalStorage.store.has('test')).toBe(false);
    });
});

describe('TokenManager', () => {
    let storage: LocalStorage;
    let tokenManager: TokenManager;
    const chainId = 123;

    beforeEach(() => {
        mockLocalStorage.store.clear();
        vi.clearAllMocks();
        storage = new LocalStorage();
        tokenManager = new TokenManager(storage, chainId, 'https://api.example.com');
    });

    describe('getToken', () => {
        it('should return null when no token exists', () => {
            const result = tokenManager.getToken();
            expect(result).toBeNull();
        });

        it('should return null when json in localstorage do not match expected schema', () => {
            mockLocalStorage.store.set(`${STORAGE_KEYS.TOKEN_PREFIX}${chainId}`, '{"invalid": "json"}');
            const result = tokenManager.getToken();
            expect(result).toBeNull();
        });

        it('should return null when invalid json in localstorage', () => {
            mockLocalStorage.store.set(`${STORAGE_KEYS.TOKEN_PREFIX}${chainId}`, '{');
            const result = tokenManager.getToken();
            expect(result).toBeNull();
        });

        it('should return cached token when valid', async () => {
            const testToken = createTestToken();

            mockSessionResponse(testToken, minutesInTheFuture(60));

            await tokenManager.setToken(testToken);

            // Clear the mock to test caching properly
            vi.clearAllMocks();

            const result1 = tokenManager.getToken();
            const result2 = tokenManager.getToken();

            expect(result1?.rawToken).toBe(testToken);
            expect(result2?.rawToken).toBe(testToken);
            // Should not call storage at all due to caching
            expect(mockLocalStorage.getItem).toHaveBeenCalledTimes(0);
        });
    });

    describe('setToken', () => {
        it('should store valid token and return parsed data', async () => {
            const testToken = createTestToken();

            const expireDate = new Date(0);

            mockSessionResponse(testToken, expireDate);

            const result = await tokenManager.setToken(testToken);

            expect(result.rawToken).toBe(testToken);
            // When the API omits renewableUntil, it falls back to expiresAt
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
                `${STORAGE_KEYS.TOKEN_PREFIX}${chainId}`,
                JSON.stringify({
                    rawToken: testToken,
                    expiresAt: expireDate.toISOString(),
                    renewableUntil: expireDate.toISOString()
                })
            );
        });
    });

    describe('setTokenDirect', () => {
        it('should store token data directly without API call', () => {
            const expiresAt = minutesInTheFuture(60);
            const tokenData = {
                rawToken: 'direct-token',
                expiresAt,
                renewableUntil: expiresAt
            };

            tokenManager.setTokenDirect(tokenData);

            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
                `${STORAGE_KEYS.TOKEN_PREFIX}${chainId}`,
                JSON.stringify(tokenData)
            );
            expect(tokenManager.getToken()?.rawToken).toBe('direct-token');
        });

        it('should cache the token in memory', () => {
            const expiresAt = minutesInTheFuture(60);
            const tokenData = {
                rawToken: 'cached-token',
                expiresAt,
                renewableUntil: expiresAt
            };

            tokenManager.setTokenDirect(tokenData);
            vi.clearAllMocks();

            const result = tokenManager.getToken();
            expect(result?.rawToken).toBe('cached-token');
            expect(mockLocalStorage.getItem).not.toHaveBeenCalled();
        });
    });

    describe('clearToken', () => {
        it('should remove token from storage and clear cache', async () => {
            const testToken = createTestToken();

            mockSessionResponse(testToken, minutesInTheFuture(60));
            await tokenManager.setToken(testToken);

            tokenManager.clearToken();

            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(`${STORAGE_KEYS.TOKEN_PREFIX}${chainId}`);
            expect(tokenManager.getToken()).toBeNull();
        });
    });

    describe('isAuthorized', () => {
        it('should return true for valid token', async () => {
            const testToken = createTestToken();

            mockSessionResponse(testToken, minutesInTheFuture(60));

            await tokenManager.setToken(testToken);

            expect(tokenManager.isAuthorized()).toBe(true);
        });

        it('should return false when no token', () => {
            expect(tokenManager.isAuthorized()).toBe(false);
        });
    });

    describe('state management', () => {
        it('should store and retrieve state', () => {
            const state = 'test-state';

            tokenManager.setState(state);
            const result = tokenManager.getState();

            expect(result).toBe(state);
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(`${STORAGE_KEYS.STATE_PREFIX}${chainId}`, state);
        });

        it('should clear state', () => {
            tokenManager.setState('test-state');
            tokenManager.clearState();

            expect(tokenManager.getState()).toBeNull();
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(`${STORAGE_KEYS.STATE_PREFIX}${chainId}`);
        });
    });

    describe('getTokenExpiration / renewableUntil', () => {
        it('returns renewableUntil from the current-session response', async () => {
            const testToken = createTestToken();
            const expiresAt = minutesInTheFuture(60);
            const renewableUntil = minutesInTheFuture(480);

            mockSessionResponse(testToken, expiresAt, renewableUntil);

            const result = await tokenManager.setToken(testToken);

            expect(result.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
            expect(result.renewableUntil.getTime()).toBeCloseTo(renewableUntil.getTime(), -2);
        });

        it('falls back to renewableUntil equal to expiresAt when the API omits it', async () => {
            const testToken = createTestToken();
            const expiresAt = minutesInTheFuture(60);

            // No renewableUntil in the response
            mockSessionResponse(testToken, expiresAt);

            const result = await tokenManager.setToken(testToken);

            expect(result.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
            expect(result.renewableUntil.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
        });

        it('treats a 404 from current-session as the far-future fallback for both deadlines', async () => {
            const testToken = createTestToken();

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

            const result = await tokenManager.setToken(testToken);

            const now = new Date();
            const ninetyYearsFromNow = new Date(now.getFullYear() + 90, now.getMonth(), now.getDate());
            expect(result.expiresAt.getTime()).toBeGreaterThan(ninetyYearsFromNow.getTime());
            expect(result.renewableUntil.getTime()).toBeGreaterThan(ninetyYearsFromNow.getTime());
        });
    });

    describe('extend', () => {
        it('updates stored expiry after a successful extend', async () => {
            const testToken = createTestToken();
            const originalExpiresAt = minutesInTheFuture(5);
            const originalAbsoluteExpiresAt = minutesInTheFuture(120);

            mockSessionResponse(testToken, originalExpiresAt, originalAbsoluteExpiresAt);
            await tokenManager.setToken(testToken);

            const newExpiresAt = minutesInTheFuture(65);
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        expiresAt: newExpiresAt.toISOString(),
                        renewableUntil: originalAbsoluteExpiresAt.toISOString()
                    })
                )
            );

            await tokenManager.extend();

            const stored = tokenManager.getToken();
            expect(stored?.expiresAt.getTime()).toBeCloseTo(newExpiresAt.getTime(), -2);
            expect(stored?.renewableUntil.getTime()).toBeCloseTo(originalAbsoluteExpiresAt.getTime(), -2);
        });

        it('treats a 404 from extend-session as a no-op and keeps the current expiry', async () => {
            const testToken = createTestToken();
            const expiresAt = minutesInTheFuture(60);
            const renewableUntil = minutesInTheFuture(480);

            mockSessionResponse(testToken, expiresAt, renewableUntil);
            await tokenManager.setToken(testToken);

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

            await tokenManager.extend();

            const stored = tokenManager.getToken();
            expect(stored?.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
            expect(stored?.renewableUntil.getTime()).toBeCloseTo(renewableUntil.getTime(), -2);
        });

        it('clears the token and fires onAuthExpiry on a 401 from extend', async () => {
            const testToken = createTestToken();
            const onAuthExpiry = vi.fn();
            const managerWithExpiry = new TokenManager(storage, chainId, 'https://api.example.com', onAuthExpiry);

            mockSessionResponse(testToken, minutesInTheFuture(60), minutesInTheFuture(480));
            await managerWithExpiry.setToken(testToken);

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

            await managerWithExpiry.extend();

            expect(onAuthExpiry).toHaveBeenCalledOnce();
            expect(managerWithExpiry.getToken()).toBeNull();
        });
    });

    describe('isLegacyFixedExpiry', () => {
        it('reports legacy fixed-expiry mode when expiresAt equals renewableUntil', async () => {
            const testToken = createTestToken();
            const expiresAt = minutesInTheFuture(60);

            // No renewableUntil — falls back to expiresAt, so both are equal
            mockSessionResponse(testToken, expiresAt);
            await tokenManager.setToken(testToken);

            expect(tokenManager.isLegacyFixedExpiry()).toBe(true);
        });

        it('reports non-legacy mode when expiresAt is before renewableUntil', async () => {
            const testToken = createTestToken();
            const expiresAt = minutesInTheFuture(60);
            const renewableUntil = minutesInTheFuture(480);

            mockSessionResponse(testToken, expiresAt, renewableUntil);
            await tokenManager.setToken(testToken);

            expect(tokenManager.isLegacyFixedExpiry()).toBe(false);
        });
    });
});
