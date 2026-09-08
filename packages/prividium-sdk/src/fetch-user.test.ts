import type { Chain } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrividiumSessionError } from './errors.ts';
import { createPrividiumChain } from './prividium-chain.js';
import { TokenManager } from './storage.js';
import type { UserProfile } from './types.js';

// Mock modules before importing anything else
vi.mock('./storage.js');
vi.mock('./popup-auth.js');

// Mock fetch
global.fetch = vi.fn();

// Mock window
Object.defineProperty(global, 'window', {
    value: {
        location: { origin: 'https://example.com' }
    },
    writable: true
});

const mockChain: Chain = {
    id: 123,
    name: 'Test Chain',
    nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18
    },
    rpcUrls: {
        default: { http: ['https://rpc.test.com'] }
    }
};

const mockConfig = {
    clientId: 'test-client-id',
    chain: mockChain,
    authBaseUrl: 'https://auth.prividium.com',
    redirectUrl: 'https://example.com/callback',
    prividiumApiBaseUrl: 'https://permissions-api.prividium.com'
};

const mockUserProfile = {
    id: 'user123',
    createdAt: '2023-01-01T00:00:00.000Z',
    displayName: 'Test User',
    updatedAt: '2023-01-02T00:00:00.000Z',
    roles: [
        { id: 'role-admin', roleName: 'admin' },
        { id: 'role-user', roleName: 'user' }
    ],
    wallets: ['0x742d35Cc6641c4532b63dA2a2d2FdC4E9e3e0b9F', '0x8ba1f109551bD432803012645Hac136c32dFe1df']
};

const expectedUserProfile: UserProfile = {
    id: 'user123',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
    displayName: 'Test User',
    updatedAt: new Date('2023-01-02T00:00:00.000Z'),
    roles: [
        { id: 'role-admin', roleName: 'admin' },
        { id: 'role-user', roleName: 'user' }
    ],
    wallets: ['0x742d35Cc6641c4532b63dA2a2d2FdC4E9e3e0b9F', '0x8ba1f109551bD432803012645Hac136c32dFe1df']
};

describe('fetchUser', () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const mockTokenManager = vi.mocked(TokenManager);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should throw error when not authenticated', async () => {
        const prividiumChain = createPrividiumChain(mockConfig);

        await expect(prividiumChain.fetchUser()).rejects.toThrow(PrividiumSessionError);

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should successfully fetch user profile when authenticated', async () => {
        // Mock TokenManager to return a valid token
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123',
            preferred_username: 'testuser'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockUserProfile)
        } as Response);

        const result = await prividiumChain.fetchUser();

        expect(mockFetch).toHaveBeenCalledWith('https://permissions-api.prividium.com/api/profiles/me', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer test-token'
            }
        });

        expect(result).toEqual(expectedUserProfile);
    });

    it('should handle 401 response by clearing token and calling onAuthExpiry', async () => {
        const mockOnAuthExpiry = vi.fn();
        const configWithCallback = { ...mockConfig, onAuthExpiry: mockOnAuthExpiry };

        const mockClearToken = vi.fn();
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'invalid-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: mockClearToken,
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChainWithCallback = createPrividiumChain(configWithCallback);

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: 'Unauthorized'
        } as Response);

        await expect(prividiumChainWithCallback.fetchUser()).rejects.toThrow(PrividiumSessionError);

        expect(mockClearToken).toHaveBeenCalled();
        expect(mockOnAuthExpiry).toHaveBeenCalled();
    });

    it('should handle other HTTP errors', async () => {
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
        } as Response);

        await expect(prividiumChain.fetchUser()).rejects.toThrow(
            'Error calling https://permissions-api.prividium.com/api/profiles/me: 500 Internal Server Error'
        );
    });

    it('should handle network errors', async () => {
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(prividiumChain.fetchUser()).rejects.toThrow('Network error');
    });

    it('should always return displayName as a string', async () => {
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockUserProfile)
        } as Response);

        const result = await prividiumChain.fetchUser();

        expect(result.displayName).toBe('Test User');
        expect(typeof result.displayName).toBe('string');
        expect(result.id).toBe('user123');
    });

    it('should parse dates correctly', async () => {
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockUserProfile)
        } as Response);

        const result = await prividiumChain.fetchUser();

        expect(result.createdAt).toBeInstanceOf(Date);
        expect(result.updatedAt).toBeInstanceOf(Date);
        expect(result.createdAt.toISOString()).toBe('2023-01-01T00:00:00.000Z');
        expect(result.updatedAt.toISOString()).toBe('2023-01-02T00:00:00.000Z');
    });

    it('should handle empty roles array', async () => {
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        const userProfileWithNoRoles = {
            ...mockUserProfile,
            roles: []
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(userProfileWithNoRoles)
        } as Response);

        const result = await prividiumChain.fetchUser();

        expect(result.roles).toEqual([]);
    });

    it('should handle empty wallet addresses array', async () => {
        const mockGetToken = vi.fn().mockReturnValue({
            rawToken: 'test-token',
            expirationDate: new Date(Date.now() + 3600000),
            sub: 'user123'
        });

        mockTokenManager.mockImplementation(
            () =>
                ({
                    getToken: mockGetToken,
                    setToken: vi.fn(),
                    clearToken: vi.fn(),
                    isAuthorized: vi.fn()
                    // biome-ignore lint/suspicious/noExplicitAny: test mock
                }) as any
        );

        const prividiumChain = createPrividiumChain(mockConfig);

        const userProfileWithNoWallets = {
            ...mockUserProfile,
            wallets: []
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve(userProfileWithNoWallets)
        } as Response);

        const result = await prividiumChain.fetchUser();

        expect(result.wallets).toEqual([]);
    });
});
