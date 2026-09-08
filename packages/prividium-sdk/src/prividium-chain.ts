import { http } from 'viem';
import type { ZodType, z } from 'zod';
import { buildChainObject, createApiMethods, type HttpMethod, rpcUrl } from './chain-core.js';
import { extractResponseError, hasPrividiumUnauthorizedError } from './error-utils.js';
import { PrividiumSessionError } from './errors.js';
import { PopupAuth } from './popup-auth.js';
import { SessionExtensionScheduler } from './session-extension.js';
import { LocalStorage, TokenManager } from './storage.js';
import type { AddNetworkParams, PopupOptions, PrividiumChain, PrividiumConfig } from './types.js';

// Extend Window interface for Wallet
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
    }
}

export function createPrividiumChain(config: PrividiumConfig): PrividiumChain {
    if (config.permissionsApiBaseUrl !== undefined) {
        throw new Error('"permissionsApiBaseUrl" was deprecated. Please use "prividiumApiBaseUrl" instead.');
    }

    const storage = config.storage || new LocalStorage();
    const tokenManager = new TokenManager(storage, config.chain.id, config.prividiumApiBaseUrl, config.onAuthExpiry);

    const scheduler = new SessionExtensionScheduler({
        tokenManager,
        config: {
            idleCheckInterval: config.idleCheckInterval,
            warningLeadTime: config.warningLeadTime,
            onSessionExpiring: config.onSessionExpiring
        }
    });

    // A page reload restores the token from storage without going through authorize(),
    // so arm the scheduler here too — otherwise the extend loop and onSessionExpiring
    // stay off and an active user is idle-timed-out.
    if (tokenManager.isAuthorized()) {
        scheduler.start();
    }

    const popupAuth = new PopupAuth({
        clientId: config.clientId,
        authBaseUrl: config.authBaseUrl,
        redirectUri: config.redirectUrl,
        org: config.org,
        tokenManager
    });

    const getAuthHeaders = (): Record<string, string> | null => {
        const tokenData = tokenManager.getToken();
        if (!tokenData) {
            return null;
        }

        return {
            Authorization: `Bearer ${tokenData.rawToken}`
        };
    };

    async function prividiumApiCall<Schema extends ZodType>(
        schema: Schema,
        url: string,
        method: HttpMethod,
        body?: string
    ): Promise<z.infer<Schema>> {
        const headers = getAuthHeaders();
        if (!headers) {
            throw new PrividiumSessionError();
        }

        scheduler.stampActivity();

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            ...(body && { body })
        });

        if (response.status === 401) {
            tokenManager.clearToken();
            config.onAuthExpiry?.();
            throw new PrividiumSessionError();
        }

        if (!response.ok) {
            const detail = await extractResponseError(response);
            throw new Error(`Error calling ${url}: ${detail}`);
        }

        const parsed = schema.safeParse(await response.json());

        if (!parsed.success) {
            throw new Error(`Unexpected api response response calling ${url}`);
        }

        return parsed.data;
    }

    // Create transport with auth integration using viem callbacks
    const transport = http(rpcUrl(config.prividiumApiBaseUrl), {
        batch: false,
        fetchOptions: {
            headers: getAuthHeaders() || {}
        },
        onFetchRequest(_request, init) {
            const isAuthenticated = tokenManager.isAuthorized();
            if (!isAuthenticated) {
                throw new PrividiumSessionError();
            }
            init.headers = {
                ...init.headers,
                ...getAuthHeaders()
            };
            scheduler.stampActivity();
        },
        onFetchResponse: async (response: Response) => {
            // Handle JSON RPC 2.0 error responses with authorization error codes
            if (await hasPrividiumUnauthorizedError(response)) {
                tokenManager.clearToken();
                config.onAuthExpiry?.();
            }
        }
    });

    const apiMethods = createApiMethods({ prividiumApiCall, prividiumApiBaseUrl: config.prividiumApiBaseUrl });

    return {
        chain: buildChainObject(config),
        transport,

        async authorize(options?: PopupOptions): Promise<string> {
            const token = await popupAuth.authorize(options);
            // Arm the scheduler after a fresh token is stored.
            // Teardown first to prevent double-scheduling if authorize is called twice.
            scheduler.teardown();
            scheduler.start();
            return token;
        },

        unauthorize(): void {
            scheduler.teardown();
            popupAuth.unauthorize();
        },

        isAuthorized(): boolean {
            return popupAuth.isAuthorized();
        },

        getAuthHeaders,

        fetchUser: apiMethods.fetchUser,
        getWalletToken: apiMethods.getWalletToken,
        getWalletRpcUrl: apiMethods.getWalletRpcUrl,
        invalidateWalletToken: apiMethods.invalidateWalletToken,
        authorizeTransaction: apiMethods.authorizeTransaction,
        fetchContractAbi: apiMethods.fetchContractAbi,

        async addNetworkToWallet(params?: AddNetworkParams): Promise<void> {
            if (typeof window === 'undefined' || !window.ethereum) {
                throw new Error('Wallet not detected. Please install a wallet extension to add network.');
            }

            const walletRpcUrl = await this.getWalletRpcUrl();
            const chainIdHex = `0x${config.chain.id.toString(16)}`;

            const networkParams = {
                chainId: params?.chainId || chainIdHex,
                chainName: params?.chainName || config.chain.name,
                nativeCurrency: params?.nativeCurrency || {
                    name: config.chain.nativeCurrency?.name || 'Ether',
                    symbol: config.chain.nativeCurrency?.symbol || 'ETH',
                    decimals: config.chain.nativeCurrency?.decimals || 18
                },
                rpcUrls: [walletRpcUrl],
                blockExplorerUrls:
                    params?.blockExplorerUrls ||
                    (config.chain.blockExplorers?.default?.url ? [config.chain.blockExplorers.default.url] : undefined)
            };

            try {
                if (!window.ethereum) {
                    throw new Error('Wallet not detected');
                }
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [networkParams]
                });
            } catch (error) {
                throw new Error(
                    `Failed to add network to wallet: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }
    };
}
