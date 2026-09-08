import type { TokenManager } from './storage.js';
import { generateRandomState } from './token-utils.js';
import { AUTH_ERRORS, type OauthScope, type PopupOptions } from './types.js';

export type { OauthScope } from './types.js';

export interface PopupAuthConfig {
    authBaseUrl: string;
    clientId: string;
    redirectUri: string;
    org?: string;
    tokenManager: TokenManager;
}

export class PopupAuth {
    private config: PopupAuthConfig;

    constructor(config: PopupAuthConfig) {
        this.config = config;
    }

    async authorize(options: PopupOptions = {}): Promise<string> {
        const { popupSize = { w: 600, h: 800 }, scopes = [] } = options;

        const state = generateRandomState();
        this.config.tokenManager.setState(state);

        const authUrl = this.buildAuthUrl(state, scopes);
        const popup = this.openPopup(authUrl, popupSize);

        return new Promise((resolve, reject) => {
            const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
            let checkInterval: NodeJS.Timeout | null = null;
            let timeoutId: NodeJS.Timeout | null = null;

            const cleanup = () => {
                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                window.removeEventListener('message', messageHandler);
            };

            const messageHandler = (event: MessageEvent<AuthCallbackMessage>) => {
                // Validate message type
                if (event.data?.type !== 'prividium-auth-callback') {
                    return;
                }

                // Validate origin matches redirect URI origin
                const redirectUrl = new URL(this.config.redirectUri);
                if (event.origin !== redirectUrl.origin) {
                    console.warn(`Received message from unexpected origin: ${event.origin}`);
                    return;
                }

                // Stop polling for popup.closed now that a definitive response
                // has arrived. Otherwise, the callback page self-closes (~100ms
                // after posting) while setToken() is still awaiting token
                // expiration, and the poll can reject with "Authentication was
                // cancelled" even though the token gets stored successfully.
                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }

                // Handle error from callback
                if (event.data.error) {
                    popup.close();
                    cleanup();
                    this.config.tokenManager.clearState();
                    this.config.tokenManager.clearToken();
                    reject(new Error(event.data.error));
                    return;
                }

                const { token, state: receivedState } = event.data;

                // Validate state
                if (!receivedState) {
                    popup.close();
                    cleanup();
                    this.config.tokenManager.clearState();
                    reject(new Error(AUTH_ERRORS.INVALID_STATE));
                    return;
                }

                if (receivedState !== state) {
                    popup.close();
                    cleanup();
                    this.config.tokenManager.clearState();
                    reject(new Error(AUTH_ERRORS.INVALID_STATE));
                    return;
                }

                // Validate token
                if (!token) {
                    popup.close();
                    cleanup();
                    this.config.tokenManager.clearState();
                    reject(new Error(AUTH_ERRORS.NO_TOKEN));
                    return;
                }

                // Success - store token and resolve
                this.config.tokenManager
                    .setToken(token)
                    .then((tokenData) => {
                        this.config.tokenManager.clearState();
                        popup.close();
                        cleanup();
                        resolve(tokenData.rawToken);
                    })
                    .catch((error) => {
                        popup.close();
                        cleanup();
                        this.config.tokenManager.clearState();
                        this.config.tokenManager.clearToken();
                        reject(error);
                    });
            };

            // Listen for postMessage from callback page
            window.addEventListener('message', messageHandler);

            // Check if popup is closed (user cancelled)
            checkInterval = setInterval(() => {
                if (popup.closed) {
                    cleanup();
                    this.config.tokenManager.clearState();
                    reject(new Error('Authentication was cancelled'));
                }
            }, 500);

            // Set timeout for authentication
            timeoutId = setTimeout(() => {
                if (!popup.closed) {
                    popup.close();
                }
                cleanup();
                this.config.tokenManager.clearState();
                reject(new Error('Authentication timeout'));
            }, TIMEOUT_MS);
        });
    }

    private buildAuthUrl(state: string, scopes?: OauthScope[]): string {
        const url = new URL('/auth/authorize', this.config.authBaseUrl);
        url.searchParams.set('client_id', this.config.clientId);
        url.searchParams.set('redirect_uri', this.config.redirectUri);
        url.searchParams.set('state', state);
        url.searchParams.set('response_type', 'token');

        if (this.config.org) {
            url.searchParams.set('org', this.config.org);
        }

        if (scopes?.length) {
            for (const scope of scopes) {
                url.searchParams.append('scope', scope);
            }
        }

        return url.toString();
    }

    private openPopup(url: string, size: { w: number; h: number }): Window {
        const left = window.screen.width / 2 - size.w / 2;
        const top = window.screen.height / 2 - size.h / 2;

        // Note: We intentionally do NOT use 'noopener' here because:
        // 1. The callback page needs window.opener to post messages back
        // 2. We validate message origin strictly in the message handler
        // 3. The auth flow goes through trusted domains (user-panel -> callback page)
        // This is the standard approach for OAuth2 popup flows
        const popup = window.open(
            url,
            'prividium-auth',
            `scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no,width=${size.w},height=${size.h},top=${top},left=${left}`
        );

        if (!popup) {
            throw new Error('Failed to open popup. Please allow popups for this site.');
        }

        return popup;
    }

    unauthorize(): void {
        this.config.tokenManager.clearToken();
        this.config.tokenManager.clearState();
    }

    isAuthorized(): boolean {
        return this.config.tokenManager.isAuthorized();
    }
}

/**
 * Interface for auth callback message posted to parent window
 */
export interface AuthCallbackMessage {
    type: 'prividium-auth-callback';
    token?: string;
    state?: string;
    error?: string;
}

/**
 * Handles the authentication callback on the redirect page.
 * This function should be called from the callback page that the user is redirected to
 * after authentication. It extracts the token and state from the URL hash and posts
 * them back to the opener window using postMessage.
 *
 * @param onError - Optional callback to handle errors (e.g., display error message to user)
 */
export function handleAuthCallback(onError?: (error: string) => void): void {
    try {
        // Check if window.opener exists
        if (!window.opener) {
            const error = 'No opener window found. This page must be opened from the authentication popup.';
            onError?.(error);
            return;
        }

        // Post only to current for secure postMessage
        const origin = window.origin;

        // Parse hash parameters
        const hash = window.location.hash.replace(/^#/, '');
        const params = new URLSearchParams(hash);
        const token = params.get('token');
        const state = params.get('state');

        if (!token) {
            const message: AuthCallbackMessage = {
                type: 'prividium-auth-callback',
                error: AUTH_ERRORS.NO_TOKEN
            };
            (window.opener as Window).postMessage(message, origin);
            onError?.(AUTH_ERRORS.NO_TOKEN);
            return;
        }

        if (!state) {
            const message: AuthCallbackMessage = {
                type: 'prividium-auth-callback',
                error: AUTH_ERRORS.NO_RECEIVED_STATE
            };
            (window.opener as Window).postMessage(message, origin);
            onError?.(AUTH_ERRORS.NO_RECEIVED_STATE);
            return;
        }

        // Post success message to opener
        const message: AuthCallbackMessage = {
            type: 'prividium-auth-callback',
            token: decodeURIComponent(token),
            state
        };

        (window.opener as Window).postMessage(message, origin);

        // Close the window after a short delay to ensure message is sent
        setTimeout(() => {
            window.close();
        }, 100);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        onError?.(errorMessage);
    }
}
