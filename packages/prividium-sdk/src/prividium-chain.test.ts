import type { Chain } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { PrividiumSessionError } from './errors.ts';
import { createPrividiumChain } from './prividium-chain.js';
import { SessionExtensionScheduler } from './session-extension.js';
import { TokenManager } from './storage.js';
import { minutesInTheFuture } from './test-utils.ts';
import type { AuthorizeTransactionParams } from './types.ts';

// Mock all the dependencies
vi.mock('./storage.js');
vi.mock('./popup-auth.js');
vi.mock('./transport.js');

// Mock window
Object.defineProperty(global, 'window', {
    value: {
        location: { origin: 'https://example.com' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
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
    prividiumApiBaseUrl: 'https://api.prividium.com'
};

describe('createPrividiumChain', () => {
    // The automocked TokenManager returns undefined from getToken(), which isAuthorized()
    // does not treat as "no token" — pin it to null so the factory starts signed out.
    beforeEach(() => {
        vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should create PrividiumChain with required config', () => {
        const result = createPrividiumChain(mockConfig);

        expect(result).toBeDefined();
        expect(result.chain.id).toBe(123);
        expect(result.chain.name).toBe('Test Chain');
        expect(result.chain.nativeCurrency).toEqual({
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18
        });
        expect(result.chain.rpcUrls).toEqual({
            default: { http: ['https://api.prividium.com/rpc'] }
        });
        expect(result.transport).toBeDefined();
        expect(typeof result.authorize).toBe('function');
        expect(typeof result.unauthorize).toBe('function');
        expect(typeof result.isAuthorized).toBe('function');
    });

    it('should create PrividiumChain with custom storage', () => {
        const customStorage = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn()
        };

        const result = createPrividiumChain({
            ...mockConfig,
            storage: customStorage
        });

        expect(result).toBeDefined();
        expect(result.chain.id).toBe(123);
        expect(result.chain.name).toBe('Test Chain');
        expect(result.chain.nativeCurrency).toEqual({
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18
        });
        expect(result.chain.rpcUrls).toEqual({
            default: { http: ['https://api.prividium.com/rpc'] }
        });
    });

    it('should create PrividiumChain with onAuthExpiry callback', () => {
        const onAuthExpiry = vi.fn();

        const result = createPrividiumChain({
            ...mockConfig,
            onAuthExpiry
        });

        expect(result).toBeDefined();
        expect(result.chain.id).toBe(123);
        expect(result.chain.name).toBe('Test Chain');
        expect(result.chain.nativeCurrency).toEqual({
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18
        });
        expect(result.chain.rpcUrls).toEqual({
            default: { http: ['https://api.prividium.com/rpc'] }
        });
    });

    it('should create PrividiumChain with OAuth scopes', () => {
        const result = createPrividiumChain(mockConfig);

        expect(result).toBeDefined();
        expect(result.chain.id).toBe(123);
        // The scopes are passed to PopupAuth internally, which we verify in popup-auth.test.ts
    });

    it('should expose all required methods', () => {
        const prividiumChain = createPrividiumChain(mockConfig);

        // Test that all required methods exist
        expect(prividiumChain.authorize).toBeDefined();
        expect(prividiumChain.unauthorize).toBeDefined();
        expect(prividiumChain.isAuthorized).toBeDefined();
        expect(prividiumChain.fetchUser).toBeDefined();

        // Test that methods are functions
        expect(typeof prividiumChain.authorize).toBe('function');
        expect(typeof prividiumChain.unauthorize).toBe('function');
        expect(typeof prividiumChain.isAuthorized).toBe('function');
        expect(typeof prividiumChain.fetchUser).toBe('function');
    });

    describe('session scheduler arming', () => {
        it('should arm the scheduler when a token is already stored', () => {
            const startSpy = vi.spyOn(SessionExtensionScheduler.prototype, 'start').mockImplementation(() => {});
            vi.spyOn(TokenManager.prototype, 'isAuthorized').mockReturnValue(true);

            createPrividiumChain(mockConfig);

            expect(startSpy).toHaveBeenCalledTimes(1);
        });

        it('should not arm the scheduler when no valid token is stored', () => {
            const startSpy = vi.spyOn(SessionExtensionScheduler.prototype, 'start').mockImplementation(() => {});
            vi.spyOn(TokenManager.prototype, 'isAuthorized').mockReturnValue(false);

            createPrividiumChain(mockConfig);

            expect(startSpy).not.toHaveBeenCalled();
        });
    });

    it('should pass chain configuration correctly', () => {
        const customChain: Chain = {
            id: 456,
            name: 'Custom Chain',
            nativeCurrency: {
                name: 'Custom Token',
                symbol: 'CTK',
                decimals: 6
            },
            rpcUrls: {
                default: { http: ['https://custom-rpc.com'] }
            }
        };

        const result = createPrividiumChain({
            ...mockConfig,
            chain: customChain
        });

        expect(result.chain.id).toBe(456);
        expect(result.chain.name).toBe('Custom Chain');
        expect(result.chain.nativeCurrency).toEqual({
            name: 'Custom Token',
            symbol: 'CTK',
            decimals: 6
        });
        expect(result.chain.rpcUrls).toEqual({
            default: { http: ['https://api.prividium.com/rpc'] }
        });
    });

    describe('fetchUser', () => {
        it('should fetch user profile successfully', async () => {
            const mockUserProfile = {
                id: 'user-123',
                createdAt: '2024-01-01T00:00:00Z',
                displayName: 'Test User',
                updatedAt: '2024-01-02T00:00:00Z',
                roles: [
                    { id: 'role-user', roleName: 'user' },
                    { id: 'role-admin', roleName: 'admin' }
                ],
                wallets: ['0x1234567890abcdef']
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockUserProfile)));

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain(mockConfig);

            const result = await prividiumChain.fetchUser();

            expect(result).toEqual({
                id: 'user-123',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                displayName: 'Test User',
                updatedAt: new Date('2024-01-02T00:00:00Z'),
                roles: [
                    { id: 'role-user', roleName: 'user' },
                    { id: 'role-admin', roleName: 'admin' }
                ],
                wallets: ['0x1234567890abcdef']
            });
            expect(global.fetch).toHaveBeenCalledWith('https://api.prividium.com/api/profiles/me', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer test-token'
                }
            });
        });

        it('should throw error when not authenticated', async () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue(null);

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.fetchUser()).rejects.toThrow(PrividiumSessionError);
        });

        it('should handle 401 response and clear token', async () => {
            const mockClearToken = vi.fn();
            const mockOnAuthExpiry = vi.fn();

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });
            vi.spyOn(TokenManager.prototype, 'clearToken').mockImplementation(mockClearToken);

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(null, {
                    status: 401,
                    statusText: 'Unauthorized'
                })
            );

            const prividiumChain = createPrividiumChain({
                ...mockConfig,
                onAuthExpiry: mockOnAuthExpiry
            });

            await expect(prividiumChain.fetchUser()).rejects.toThrow(PrividiumSessionError);
            expect(mockClearToken).toHaveBeenCalled();
            expect(mockOnAuthExpiry).toHaveBeenCalled();
        });

        it('should throw error on other response errors', async () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(null, {
                    status: 500,
                    statusText: 'Internal Server Error'
                })
            );

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.fetchUser()).rejects.toThrow(
                'Error calling https://api.prividium.com/api/profiles/me: 500 Internal Server Error'
            );
        });
    });

    describe('getWalletToken', () => {
        it('should return wallet token from user profile', async () => {
            const mockWalletTokenResponse = {
                token: 'wallet-token-abc123'
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockWalletTokenResponse)));

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain(mockConfig);

            const result = await prividiumChain.getWalletToken();

            expect(result).toBe('wallet-token-abc123');
        });

        it('should throw error when wallet token is not available', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    statusText: 'FORBIDDEN'
                })
            );

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });
            vi.spyOn(TokenManager.prototype, 'clearToken').mockReturnValue(undefined);

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.getWalletToken()).rejects.toThrow(
                'No session started or previous session expired. Please call authorize() first.'
            );
        });

        it('should throw error when wallet token returns error', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 500,
                    statusText: 'ERROR ERROR ERROR'
                })
            );

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.getWalletToken()).rejects.toThrow(
                'Error calling https://api.prividium.com/api/wallet/personal-rpc-token: 500 ERROR ERROR ERROR'
            );
        });
    });

    describe('getWalletRpcUrl', () => {
        it('should construct wallet RPC URL with token', async () => {
            const mockWalletTokenResponse = {
                token: 'wallet-token-abc123'
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockWalletTokenResponse)));

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain({
                ...mockConfig
            });

            const result = await prividiumChain.getWalletRpcUrl();

            expect(result).toBe('https://api.prividium.com/rpc/wallet/wallet-token-abc123');
        });

        it('should handle api url with /api path', async () => {
            const mockWalletTokenResponse = {
                token: 'token-xyz'
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockWalletTokenResponse)));

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain({
                ...mockConfig,
                prividiumApiBaseUrl: 'https://api.com/api'
            });

            const result = await prividiumChain.getWalletRpcUrl();

            expect(result).toBe('https://api.com/rpc/wallet/token-xyz');
        });
    });

    describe('invalidateWalletToken', () => {
        it('should invalidate wallet token and return new token', async () => {
            const mockResponse = {
                newWalletToken: 'new-wallet-token-xyz',
                message: 'Token invalidated successfully'
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)));
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain(mockConfig);

            const result = await prividiumChain.invalidateWalletToken();

            expect(result).toBe('new-wallet-token-xyz');
            expect(global.fetch).toHaveBeenCalledWith('https://api.prividium.com/api/wallet/invalidate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer test-token'
                }
            });
        });

        it('should throw error when not authenticated', async () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue(null);

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.invalidateWalletToken()).rejects.toThrow(
                'No session started or previous session expired. Please call authorize() first.'
            );
        });

        it('should throw error on failed invalidation', async () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(null, {
                    status: 500,
                    statusText: 'Internal Server Error'
                })
            );

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.invalidateWalletToken()).rejects.toThrow(
                'Error calling https://api.prividium.com/api/wallet/invalidate: 500 Internal Server Error'
            );
        });
    });

    describe('addNetworkToWallet', () => {
        it('should add network to wallet with default params', async () => {
            const mockWalletTokenResponse = {
                token: 'wallet-token-abc123'
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockWalletTokenResponse)));

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const mockRequest = vi.fn().mockResolvedValue(undefined);
            global.window.ethereum = { request: mockRequest };

            const prividiumChain = createPrividiumChain({
                ...mockConfig,
                prividiumApiBaseUrl: 'https://api.prividium.com/rpc/v1'
            });

            await prividiumChain.addNetworkToWallet();

            expect(mockRequest).toHaveBeenCalledWith({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: '0x7b',
                        chainName: 'Test Chain',
                        nativeCurrency: {
                            name: 'Ether',
                            symbol: 'ETH',
                            decimals: 18
                        },
                        rpcUrls: ['https://api.prividium.com/rpc/wallet/wallet-token-abc123'],
                        blockExplorerUrls: undefined
                    }
                ]
            });
        });

        it('should add network with custom params', async () => {
            const mockWalletTokenResponse = {
                token: 'wallet-token-abc123'
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockWalletTokenResponse)));

            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const mockRequest = vi.fn().mockResolvedValue(undefined);
            global.window.ethereum = { request: mockRequest };

            const customChainWithExplorer: Chain = {
                ...mockChain,
                blockExplorers: {
                    default: {
                        name: 'Explorer',
                        url: 'https://explorer.test.com'
                    }
                }
            };

            const prividiumChain = createPrividiumChain({
                ...mockConfig,
                chain: customChainWithExplorer
            });

            await prividiumChain.addNetworkToWallet({
                chainId: '0x99',
                chainName: 'Custom Network',
                nativeCurrency: {
                    name: 'Custom Token',
                    symbol: 'CTK',
                    decimals: 6
                },
                blockExplorerUrls: ['https://custom-explorer.com']
            });

            expect(mockRequest).toHaveBeenCalledWith({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: '0x99',
                        chainName: 'Custom Network',
                        nativeCurrency: {
                            name: 'Custom Token',
                            symbol: 'CTK',
                            decimals: 6
                        },
                        rpcUrls: ['https://api.prividium.com/rpc/wallet/wallet-token-abc123'],
                        blockExplorerUrls: ['https://custom-explorer.com']
                    }
                ]
            });
        });

        it('should throw error when wallet is not detected', async () => {
            delete global.window.ethereum;
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.addNetworkToWallet()).rejects.toThrow(
                'Wallet not detected. Please install a wallet extension to add network.'
            );
        });

        it('should throw error on wallet request failure', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: 'user-123',
                        createdAt: '2024-01-01T00:00:00Z',
                        displayName: 'Test User',
                        updatedAt: '2024-01-02T00:00:00Z',
                        roles: ['user'],
                        walletAddresses: ['0x1234567890abcdef']
                    })
                )
            );
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const mockRequest = vi.fn().mockRejectedValue(new Error('User rejected request'));
            global.window.ethereum = { request: mockRequest };

            const prividiumChain = createPrividiumChain(mockConfig);

            await expect(prividiumChain.addNetworkToWallet()).rejects.toThrow('Unexpected api response response');
        });
    });

    describe('getAuthHeaders', () => {
        it('should return auth headers when token exists', () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const prividiumChain = createPrividiumChain(mockConfig);

            const headers = prividiumChain.getAuthHeaders();

            expect(headers).toEqual({
                Authorization: 'Bearer test-token'
            });
        });

        it('should return null when token does not exist', () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue(null);

            const prividiumChain = createPrividiumChain(mockConfig);

            const headers = prividiumChain.getAuthHeaders();

            expect(headers).toBeNull();
        });
    });

    describe('authorizeTransaction', () => {
        it('sends request', async () => {
            vi.spyOn(TokenManager.prototype, 'getToken').mockReturnValue({
                rawToken: 'test-token',
                expiresAt: minutesInTheFuture(60),
                renewableUntil: minutesInTheFuture(60)
            });

            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        message: 'foo',
                        activeUntil: '2024-12-12T12:00:00Z'
                    })
                )
            );

            const prividiumChain = createPrividiumChain(mockConfig);

            const params: AuthorizeTransactionParams = {
                toAddress: '0x0000000000000000000000000000000000000000',
                value: 0n,
                nonce: 1,
                walletAddress: '0x1111111111111111111111111111111111111111'
            };

            await prividiumChain.authorizeTransaction(params);

            expect(fetchSpy).toHaveBeenCalled();
            const fetchCall = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
            const [, init] = fetchCall as [string, Record<string, unknown>];

            expect(init.body).toBeDefined();
            expect(init.body).toEqual(
                JSON.stringify({
                    toAddress: '0x0000000000000000000000000000000000000000',
                    value: '0',
                    nonce: 1,
                    walletAddress: '0x1111111111111111111111111111111111111111',
                    calldata: '0x'
                })
            );

            fetchSpy.mockRestore();
        });
    });
});
