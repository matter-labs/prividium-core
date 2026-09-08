import { type Address, type Chain, http, type LocalAccount, type Transport } from 'viem';
import type { ZodType, z } from 'zod';
import { type AdminMethods, createAdminMethods } from './admin-api/index.js';
import { buildChainObject, createApiMethods, type HttpMethod, rpcUrl } from './chain-core.js';
import { extractResponseError, isPrividiumUnauthorizedRpcError } from './error-utils.js';
import { PrividiumSessionError } from './errors.js';
import { MemoryStorage } from './memory-storage.js';
import { SiweAuth } from './siwe-auth.js';
import { TokenManager } from './storage.js';
import type {
    AuthorizeTransactionParams,
    AuthorizeTransactionResponse,
    ContractAbiResponse,
    Storage,
    TokenData,
    UserProfile
} from './types.js';

export interface PrividiumSiweConfig {
    chain: Omit<Chain, 'rpcUrls'>;
    prividiumApiBaseUrl: string;
    account: LocalAccount;
    domain?: string;
    storage?: Storage;
    autoReauthenticate?: boolean;
    onAuthExpiry?: () => void;
    onReauthenticate?: () => void;
    onReauthenticateError?: (error: Error) => void;
}

export interface PrividiumSiweChain {
    chain: Chain;
    transport: Transport;
    address: Address;
    authorize(): Promise<TokenData>;
    unauthorize(): void;
    isAuthorized(): boolean;
    getAuthHeaders(): Record<string, string> | null;
    fetchUser(): Promise<UserProfile>;
    getWalletToken(): Promise<string>;
    getWalletRpcUrl(): Promise<string>;
    invalidateWalletToken(): Promise<string>;
    authorizeTransaction(params: AuthorizeTransactionParams): Promise<AuthorizeTransactionResponse>;
    fetchContractAbi(contractAddress: Address): Promise<ContractAbiResponse>;
    admin: AdminMethods;
}

export function createPrividiumSiweChain(config: PrividiumSiweConfig): PrividiumSiweChain {
    const autoReauth = config.autoReauthenticate ?? true;
    const storage = config.storage ?? new MemoryStorage();

    const tokenManager = new TokenManager(storage, config.chain.id, config.prividiumApiBaseUrl, config.onAuthExpiry);

    const siweAuth = new SiweAuth({
        account: config.account,
        prividiumApiBaseUrl: config.prividiumApiBaseUrl,
        domain: config.domain,
        tokenManager
    });

    // Deduplication: only one reauthentication flow at a time
    let reauthPromise: Promise<TokenData> | null = null;

    async function reauthenticate(): Promise<TokenData> {
        if (reauthPromise) {
            return reauthPromise;
        }

        reauthPromise = (async () => {
            try {
                const tokenData = await siweAuth.authorize();
                config.onReauthenticate?.();
                return tokenData;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                config.onReauthenticateError?.(err);
                throw err;
            } finally {
                reauthPromise = null;
            }
        })();

        return reauthPromise;
    }

    async function ensureAuthorized(): Promise<void> {
        if (!tokenManager.isAuthorized() && autoReauth) {
            await reauthenticate();
        }
        if (!tokenManager.isAuthorized()) {
            throw new PrividiumSessionError();
        }
    }

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
        await ensureAuthorized();

        const headers = getAuthHeaders();
        if (!headers) {
            throw new PrividiumSessionError();
        }

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

            // Attempt reauthentication and retry once
            if (autoReauth) {
                try {
                    await reauthenticate();
                    const retryHeaders = getAuthHeaders();
                    if (!retryHeaders) throw new PrividiumSessionError();

                    const retryResponse = await fetch(url, {
                        method,
                        headers: { 'Content-Type': 'application/json', ...retryHeaders },
                        ...(body && { body })
                    });

                    if (!retryResponse.ok) {
                        config.onAuthExpiry?.();
                        throw new PrividiumSessionError();
                    }

                    const parsed = schema.safeParse(await retryResponse.json());
                    if (!parsed.success) {
                        throw new Error(`Unexpected api response calling ${url}`);
                    }
                    return parsed.data;
                } catch {
                    config.onAuthExpiry?.();
                    throw new PrividiumSessionError();
                }
            }

            config.onAuthExpiry?.();
            throw new PrividiumSessionError();
        }

        if (!response.ok) {
            const detail = await extractResponseError(response);
            throw new Error(`Error calling ${url}: ${detail}`);
        }

        const parsed = schema.safeParse(await response.json());
        if (!parsed.success) {
            throw new Error(`Unexpected api response calling ${url}`);
        }
        return parsed.data;
    }

    // Create transport with auth integration using viem callbacks
    const baseTransport = http(rpcUrl(config.prividiumApiBaseUrl), {
        batch: false,
        fetchOptions: {
            headers: getAuthHeaders() || {}
        },
        onFetchRequest(_request, init) {
            const authHeaders = getAuthHeaders();
            if (authHeaders) {
                init.headers = {
                    ...init.headers,
                    ...authHeaders
                };
            }
        }
    });
    const transport: Transport = (parameters) => {
        const base = baseTransport(parameters);
        return {
            ...base,
            async request(request) {
                await ensureAuthorized();
                try {
                    return await base.request(request);
                } catch (error) {
                    if (!isPrividiumUnauthorizedRpcError(error)) {
                        throw error;
                    }

                    if (!autoReauth) {
                        config.onAuthExpiry?.();
                        throw error;
                    }

                    tokenManager.clearToken();
                    await reauthenticate();
                    return base.request(request);
                }
            }
        };
    };

    const apiMethods = createApiMethods({ prividiumApiCall, prividiumApiBaseUrl: config.prividiumApiBaseUrl });
    const admin = createAdminMethods({ prividiumApiCall, prividiumApiBaseUrl: config.prividiumApiBaseUrl });

    return {
        chain: buildChainObject(config),
        transport,
        address: config.account.address,

        async authorize(): Promise<TokenData> {
            return siweAuth.authorize();
        },

        unauthorize(): void {
            siweAuth.unauthorize();
        },

        isAuthorized(): boolean {
            return siweAuth.isAuthorized();
        },

        getAuthHeaders,

        fetchUser: apiMethods.fetchUser,
        getWalletToken: apiMethods.getWalletToken,
        getWalletRpcUrl: apiMethods.getWalletRpcUrl,
        invalidateWalletToken: apiMethods.invalidateWalletToken,
        authorizeTransaction: apiMethods.authorizeTransaction,
        fetchContractAbi: apiMethods.fetchContractAbi,
        admin
    };
}
