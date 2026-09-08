import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthCallbackMessage, handleAuthCallback, PopupAuth } from './popup-auth.js';
import { LocalStorage, TokenManager } from './storage.js';
import { minutesInTheFuture, mockSessionResponse } from './test-utils.ts';
import { AUTH_ERRORS } from './types.js';

// Mock window.open
const mockPopup = {
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    location: {
        href: 'https://auth.example.com/auth/authorize',
        hash: ''
    },
    opener: null as Window | null
};

// Store message listeners for testing
let messageListeners: ((event: MessageEvent) => void)[] = [];

// Mock window object
const mockWindow = {
    open: vi.fn(() => mockPopup),
    addEventListener: vi.fn((event: string, handler: (e: MessageEvent) => void) => {
        if (event === 'message') {
            messageListeners.push(handler);
        }
    }),
    removeEventListener: vi.fn((event: string, handler: (e: MessageEvent) => void) => {
        if (event === 'message') {
            messageListeners = messageListeners.filter((h) => h !== handler);
        }
    }),
    location: { origin: 'https://example.com', hash: '' },
    screen: { width: 1920, height: 1080 },
    close: vi.fn()
};

Object.defineProperty(globalThis, 'window', {
    value: mockWindow,
    writable: true
});

// Helper to simulate postMessage from callback
function simulatePostMessage(data: AuthCallbackMessage, origin = 'https://example.com') {
    const event = new MessageEvent('message', {
        data,
        origin
    });
    for (const handler of messageListeners) handler(event);
}

// Mock crypto
Object.defineProperty(globalThis, 'crypto', {
    value: {
        getRandomValues: vi.fn((array: unknown[]) => {
            for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256);
            }
            return array;
        })
    },
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

describe('PopupAuth', () => {
    let storage: LocalStorage;
    let tokenManager: TokenManager;
    let popupAuth: PopupAuth;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockPopup.closed = false;
        mockPopup.location.href = 'https://auth.example.com/auth/authorize';
        mockPopup.location.hash = '';
        messageListeners = [];

        storage = new LocalStorage();
        tokenManager = new TokenManager(storage, 123, 'https://api.example.com');

        popupAuth = new PopupAuth({
            authBaseUrl: 'https://auth.example.com',
            clientId: 'test-client',
            redirectUri: 'https://example.com/callback',
            tokenManager
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('authorize', () => {
        it('should open popup with correct URL and parameters', async () => {
            const authPromise = popupAuth.authorize();

            expect(window.open).toHaveBeenCalledWith(
                expect.stringMatching(/^https:\/\/auth\.example\.com\/auth\/authorize\?/),
                'prividium-auth',
                expect.stringContaining('width=600,height=800')
            );

            // Verify URL parameters
            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            expect(url.searchParams.get('client_id')).toBe('test-client');
            expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/callback');
            expect(url.searchParams.get('response_type')).toBe('token');
            expect(url.searchParams.get('state')).toBeTruthy();

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('appends the org query param to the popup URL when org is configured', async () => {
            const orgPopupAuth = new PopupAuth({
                authBaseUrl: 'https://auth.example.com',
                clientId: 'test-client',
                redirectUri: 'https://example.com/callback',
                org: 'acme',
                tokenManager
            });

            const authPromise = orgPopupAuth.authorize();

            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            expect(url.searchParams.get('org')).toBe('acme');
            // Adding org must not disturb the security-critical params (AC5).
            expect(url.searchParams.get('state')).toBeTruthy();
            expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/callback');
            expect(url.searchParams.get('response_type')).toBe('token');

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('omits the org query param from the popup URL when org is not configured', async () => {
            const authPromise = popupAuth.authorize();

            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            expect(url.searchParams.get('org')).toBeNull();

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('should use custom popup size when provided', async () => {
            const authPromise = popupAuth.authorize({ popupSize: { w: 800, h: 900 } });

            expect(window.open).toHaveBeenCalledWith(
                expect.any(String),
                'prividium-auth',
                expect.stringContaining('width=800,height=900')
            );

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('should include OAuth scopes in URL when provided', async () => {
            // Pass scopes to authorize() method instead of constructor
            const authPromise = popupAuth.authorize({
                scopes: ['wallet:required', 'network:required']
            });

            // Verify URL parameters include scopes
            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);

            // Check that both scopes are included
            const scopeParams = url.searchParams.getAll('scope');
            expect(scopeParams).toContain('wallet:required');
            expect(scopeParams).toContain('network:required');

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('should reject when popup is closed by user', async () => {
            const authPromise = popupAuth.authorize();

            // Simulate popup being closed
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);

            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('should resolve with token on successful authentication', async () => {
            const testToken = createTestToken();
            mockSessionResponse(testToken, minutesInTheFuture(60));
            const authPromise = popupAuth.authorize();

            // Get the state from the auth URL
            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            const state = url.searchParams.get('state') ?? undefined;

            // Simulate postMessage from callback page
            simulatePostMessage({
                type: 'prividium-auth-callback',
                token: testToken,
                state: state
            });

            const result = await authPromise;
            expect(result).toBe(testToken);
            expect(mockPopup.close).toHaveBeenCalled();
        });

        it('should resolve when popup self-closes before setToken finishes', async () => {
            // Callback page self-closes ~100ms after posting the message; the
            // checkInterval polls every 500ms. If setToken (which awaits the
            // session/expiration fetch) hasn't resolved by the next poll, the
            // poll used to reject with "Authentication was cancelled" even
            // though the token ended up stored. Reproduce that race: resolve
            // the fetch only after advancing timers past the poll interval.
            const testToken = createTestToken();
            let resolveFetch: (value: Response) => void = () => {};
            vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
                () =>
                    new Promise<Response>((resolve) => {
                        resolveFetch = resolve;
                    })
            );

            const authPromise = popupAuth.authorize();

            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            const state = url.searchParams.get('state') ?? undefined;

            simulatePostMessage({
                type: 'prividium-auth-callback',
                token: testToken,
                state
            });

            // Popup self-closed while setToken is still awaiting the fetch,
            // and the next poll tick fires.
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);

            // Fetch resolves after the poll would have fired.
            resolveFetch(
                new Response(
                    JSON.stringify({
                        token: testToken,
                        expiresAt: minutesInTheFuture(60).toISOString()
                    })
                )
            );

            await expect(authPromise).resolves.toBe(testToken);
        });

        it('should reject with invalid state error when state mismatch', async () => {
            const testToken = createTestToken();
            const authPromise = popupAuth.authorize();

            // Simulate postMessage with wrong state
            simulatePostMessage({
                type: 'prividium-auth-callback',
                token: testToken,
                state: 'wrong-state'
            });

            await expect(authPromise).rejects.toThrow(AUTH_ERRORS.INVALID_STATE);
            expect(mockPopup.close).toHaveBeenCalled();
        });

        it('should reject when no token is provided', async () => {
            const authPromise = popupAuth.authorize();

            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            const state = url.searchParams.get('state');

            // Simulate postMessage without token
            simulatePostMessage({
                type: 'prividium-auth-callback',
                state: state ?? undefined
            });

            await expect(authPromise).rejects.toThrow(AUTH_ERRORS.NO_TOKEN);
            expect(mockPopup.close).toHaveBeenCalled();
        });

        it('should reject when no state is provided', async () => {
            const testToken = createTestToken();
            const authPromise = popupAuth.authorize();

            // Simulate postMessage without state
            simulatePostMessage({
                type: 'prividium-auth-callback',
                token: testToken
            });

            await expect(authPromise).rejects.toThrow(AUTH_ERRORS.INVALID_STATE);
            expect(mockPopup.close).toHaveBeenCalled();
        });

        it('should ignore messages from wrong origin', async () => {
            const testToken = createTestToken();
            const authPromise = popupAuth.authorize();

            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            const state = url.searchParams.get('state');

            // Simulate postMessage from wrong origin
            simulatePostMessage(
                {
                    type: 'prividium-auth-callback',
                    token: testToken,
                    state: state ?? undefined
                },
                'https://malicious.com'
            );

            // Should not resolve
            vi.advanceTimersByTime(100);
            expect(mockPopup.close).not.toHaveBeenCalled();

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('should ignore messages with wrong type', async () => {
            const authPromise = popupAuth.authorize();

            // Simulate postMessage with wrong type
            simulatePostMessage({
                type: 'some-other-message',
                token: 'token',
                state: 'state'
            } as unknown as AuthCallbackMessage);

            // Should not resolve
            vi.advanceTimersByTime(100);
            expect(mockPopup.close).not.toHaveBeenCalled();

            // Clean up
            mockPopup.closed = true;
            vi.advanceTimersByTime(500);
            await expect(authPromise).rejects.toThrow('Authentication was cancelled');
        });

        it('should timeout after 5 minutes', async () => {
            const authPromise = popupAuth.authorize();

            // Advance timers by 5 minutes
            vi.advanceTimersByTime(5 * 60 * 1000);

            await expect(authPromise).rejects.toThrow('Authentication timeout');
            expect(mockPopup.close).toHaveBeenCalled();
        });

        it('should handle error from callback', async () => {
            const authPromise = popupAuth.authorize();

            // Simulate error message from callback
            simulatePostMessage({
                type: 'prividium-auth-callback',
                error: 'Something went wrong'
            });

            await expect(authPromise).rejects.toThrow('Something went wrong');
            expect(mockPopup.close).toHaveBeenCalled();
        });

        it('should clean up message listeners on success', async () => {
            const testToken = createTestToken();
            mockSessionResponse(testToken, minutesInTheFuture(60));
            const authPromise = popupAuth.authorize();

            const calledUrl = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
            const url = new URL(calledUrl);
            const state = url.searchParams.get('state');

            simulatePostMessage({
                type: 'prividium-auth-callback',
                token: testToken,
                state: state ?? undefined
            });

            await authPromise;
            expect(messageListeners.length).toBe(0);
        });
    });

    describe('unauthorize', () => {
        it('should clear token and state', async () => {
            const testToken = createTestToken();
            mockSessionResponse(testToken, minutesInTheFuture(60));
            await tokenManager.setToken(testToken);
            tokenManager.setState('test-state');

            popupAuth.unauthorize();

            expect(tokenManager.getToken()).toBeNull();
            expect(tokenManager.getState()).toBeNull();
        });
    });

    describe('isAuthorized', () => {
        it('should return tokenManager authorization status', async () => {
            expect(popupAuth.isAuthorized()).toBe(false);

            const testToken = createTestToken();
            mockSessionResponse(testToken, minutesInTheFuture(60));
            await tokenManager.setToken(testToken);

            expect(popupAuth.isAuthorized()).toBe(true);
        });
    });
});

describe('handleAuthCallback', () => {
    let mockOpener: Window;
    let postMessageSpy: ReturnType<typeof vi.fn>;
    let originalOpener: Window | null;

    beforeEach(() => {
        vi.clearAllMocks();
        postMessageSpy = vi.fn();
        mockOpener = {
            postMessage: postMessageSpy,
            origin: 'https://example.com'
        } as unknown as Window;

        // Store original opener
        originalOpener = window.opener as Window | null;

        // Reset window mock and set opener
        mockWindow.location.hash = '';
        mockWindow.close = vi.fn();

        // Set window.opener directly
        Object.defineProperty(window, 'opener', {
            value: mockOpener,
            writable: true,
            configurable: true
        });

        // Set window.origin for security checks
        Object.defineProperty(window, 'origin', {
            value: 'https://example.com',
            writable: true,
            configurable: true
        });
    });

    afterEach(() => {
        // Restore original opener
        Object.defineProperty(window, 'opener', {
            value: originalOpener,
            writable: true,
            configurable: true
        });
    });

    it('should extract token and state from hash and post message to opener', () => {
        const testToken = createTestToken();
        const testState = 'test-state-123';

        window.location.hash = `#token=${encodeURIComponent(testToken)}&state=${testState}`;

        handleAuthCallback();

        expect(postMessageSpy).toHaveBeenCalledWith(
            {
                type: 'prividium-auth-callback',
                token: testToken,
                state: testState
            },
            'https://example.com'
        );
    });

    it('should decode URI-encoded token', () => {
        const testToken = createTestToken();
        const testState = 'test-state-123';

        window.location.hash = `#token=${encodeURIComponent(testToken)}&state=${testState}`;

        handleAuthCallback();

        expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                token: testToken
            }),
            'https://example.com'
        );
    });

    it('should post error message when no token is provided', () => {
        window.location.hash = '#state=test-state';

        const onError = vi.fn();
        handleAuthCallback(onError);

        expect(postMessageSpy).toHaveBeenCalledWith(
            {
                type: 'prividium-auth-callback',
                error: AUTH_ERRORS.NO_TOKEN
            },
            'https://example.com'
        );
        expect(onError).toHaveBeenCalledWith(AUTH_ERRORS.NO_TOKEN);
    });

    it('should post error message when no state is provided', () => {
        const testToken = createTestToken();
        window.location.hash = `#token=${encodeURIComponent(testToken)}`;

        const onError = vi.fn();
        handleAuthCallback(onError);

        expect(postMessageSpy).toHaveBeenCalledWith(
            {
                type: 'prividium-auth-callback',
                error: AUTH_ERRORS.NO_RECEIVED_STATE
            },
            'https://example.com'
        );
        expect(onError).toHaveBeenCalledWith(AUTH_ERRORS.NO_RECEIVED_STATE);
    });

    it('should call onError when window.opener is not available', () => {
        Object.defineProperty(window, 'opener', {
            value: null,
            writable: true,
            configurable: true
        });

        const onError = vi.fn();
        handleAuthCallback(onError);

        expect(onError).toHaveBeenCalledWith(
            'No opener window found. This page must be opened from the authentication popup.'
        );
        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should call onError on exception', () => {
        postMessageSpy.mockImplementation(() => {
            throw new Error('postMessage failed');
        });

        const testToken = createTestToken();
        window.location.hash = `#token=${testToken}&state=test-state`;

        const onError = vi.fn();
        handleAuthCallback(onError);

        expect(onError).toHaveBeenCalledWith('postMessage failed');
    });

    it('should work without onError callback', () => {
        Object.defineProperty(window, 'opener', {
            value: null,
            writable: true,
            configurable: true
        });

        // Should not throw
        expect(() => handleAuthCallback()).not.toThrow();
    });
});
