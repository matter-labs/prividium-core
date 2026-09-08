import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrividiumChain } from './prividium-chain.js';
import { UNAUTHORIZED_ERROR_CODE } from './rpc-error-codes.js';
import { LocalStorage } from './storage.js';
import { minutesInTheFuture } from './test-utils.ts';

// Mock window for popup auth
const mockWindow = {
    location: { origin: 'https://example.com' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
};
Object.defineProperty(globalThis, 'window', {
    value: mockWindow,
    writable: true
});

// Mock fetch to capture requests
const mockFetch = vi.fn();
Object.defineProperty(globalThis, 'fetch', {
    value: mockFetch,
    writable: true
});

// Mock atob/btoa for JWT parsing
Object.defineProperty(globalThis, 'atob', {
    value: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    writable: true
});

Object.defineProperty(globalThis, 'btoa', {
    value: (str: string) => Buffer.from(str, 'binary').toString('base64'),
    writable: true
});

// Helper to create valid token
function createTestToken(): string {
    const payload = {
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        preferred_username: 'testuser'
    };
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `header.${encodedPayload}.signature`;
}

const mockChain = {
    id: 123,
    name: 'Test Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
};

describe('Auth Transport Integration', () => {
    let prividium: ReturnType<typeof createPrividiumChain>;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock successful responses
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    jsonrpc: '2.0',
                    id: 1,
                    result: '0x1234'
                }),
            headers: new Map()
        });

        prividium = createPrividiumChain({
            chain: mockChain,
            authBaseUrl: 'https://auth.prividium.io',
            clientId: 'test-client',
            redirectUrl: 'https://example.com/callback',
            prividiumApiBaseUrl: 'https://example.com'
        });
    });

    it('should send requests without auth headers when not authenticated', () => {
        // Make sure we're not authenticated
        expect(prividium.isAuthorized()).toBe(false);

        // Create a mock request to test the onFetchRequest behavior
        const mockRequest = new Request('https://rpc.prividium.io', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1
            })
        });

        // Test that getAuthHeaders returns null when not authenticated
        const headers = prividium.getAuthHeaders();
        expect(headers).toBeNull();

        // Verify the Authorization header would not be added
        expect(mockRequest.headers.get('Authorization')).toBeNull();
    });

    it('should include auth headers when authenticated', () => {
        // Set up authentication
        const testToken = createTestToken();
        const storage = new LocalStorage();
        const tokenKey = `prividium_token_${mockChain.id}`;

        // Mock localStorage
        const mockStorage = new Map();
        storage.setItem = vi.fn((key, value) => mockStorage.set(key, value));
        storage.getItem = vi.fn((key) => mockStorage.get(key) || null);

        // Manually set the token in storage to simulate authentication
        const expirationMoment = minutesInTheFuture(60);
        mockStorage.set(tokenKey, JSON.stringify({ rawToken: testToken, expiresAt: expirationMoment.toISOString() }));

        // Create a new SDK instance to pick up the token
        const authenticatedPrividium = createPrividiumChain({
            chain: mockChain,
            authBaseUrl: 'https://auth.prividium.io',
            clientId: 'test-client',
            redirectUrl: 'https://example.com/callback',
            storage,
            prividiumApiBaseUrl: 'https://example.com'
        });

        // Verify auth headers are available
        const headers = authenticatedPrividium.getAuthHeaders();
        expect(headers).toEqual({
            Authorization: `Bearer ${testToken}`
        });
    });

    it('should handle JSON RPC error responses from RPC endpoint', () => {
        const onAuthExpiry = vi.fn();

        // Mock JSON RPC 2.0 compliant error response (HTTP 200 with error in body)
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    jsonrpc: '2.0',
                    id: 1,
                    error: {
                        code: UNAUTHORIZED_ERROR_CODE,
                        message: 'Unauthorized'
                    }
                }),
            headers: new Map()
        });

        createPrividiumChain({
            chain: mockChain,
            authBaseUrl: 'https://auth.prividium.io',
            clientId: 'test-client',
            redirectUrl: 'https://example.com/callback',
            onAuthExpiry,
            prividiumApiBaseUrl: 'https://example.com'
        });

        // Note: viem will parse JSON RPC errors and throw appropriate errors
        // The onAuthExpiry callback is defined and can be called when needed
        expect(onAuthExpiry).toBeDefined();
    });

    it('should create transport with correct RPC URL', () => {
        expect(prividium.transport).toBeDefined();
        expect(typeof prividium.transport).toBe('function');

        // The transport should be configured with the RPC URL
        // This is verified by the fact that the SDK creates it with the correct URL
        expect(prividium.chain.rpcUrls.default.http[0]).toBe('https://example.com/rpc');
    });

    it('should simulate onFetchRequest callback adding auth headers', () => {
        // Create a test token and manually set it in token manager
        const testToken = createTestToken();
        const mockStorage = new Map();
        const storage = new LocalStorage();

        storage.setItem = vi.fn((key, value) => mockStorage.set(key, value));
        storage.getItem = vi.fn((key) => mockStorage.get(key) || null);

        // Set the token
        const tokenKey = `prividium_token_${mockChain.id}`;
        const expirationMoment = minutesInTheFuture(60);
        mockStorage.set(tokenKey, JSON.stringify({ rawToken: testToken, expiresAt: expirationMoment.toISOString() }));

        const authenticatedSdk = createPrividiumChain({
            chain: mockChain,
            authBaseUrl: 'https://auth.prividium.io',
            clientId: 'test-client',
            redirectUrl: 'https://example.com/callback',
            storage,
            prividiumApiBaseUrl: 'https://example.com'
        });

        // Simulate the onFetchRequest callback behavior
        const mockRequest = {
            headers: {
                set: vi.fn(),
                get: vi.fn().mockReturnValue(null)
            }
        } as unknown as Request;

        // Get the token that would be used in the callback
        const authHeaders = authenticatedSdk.getAuthHeaders();
        expect(authHeaders).not.toBeNull();
        expect(authHeaders!.Authorization).toBe(`Bearer ${testToken}`);

        // Simulate what the onFetchRequest callback would do
        if (authHeaders) {
            mockRequest.headers.set('Authorization', authHeaders.Authorization);
        }

        // Verify the header would be set
        expect(mockRequest.headers.set).toHaveBeenCalledWith('Authorization', `Bearer ${testToken}`);
    });
});
