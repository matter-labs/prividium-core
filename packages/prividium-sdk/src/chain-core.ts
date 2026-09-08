import type { Chain } from 'viem';
import { mainnet } from 'viem/chains';
import { type ZodType, z } from 'zod';

import {
    type AuthorizeTransactionParams,
    type AuthorizeTransactionResponse,
    authorizeTransactionResponseSchema,
    type ContractAbiResponse,
    contractAbiResponseSchema,
    profileResponseSchema,
    type UserProfile
} from './types.js';

export function rpcUrl(apiUrl: string): string {
    return new URL('/rpc', apiUrl).toString();
}

export function walletRpcUrl(apiUrl: string, token: string): string {
    return new URL(`/rpc/wallet/${token}`, apiUrl).toString();
}

export function buildChainObject(config: { chain: Omit<Chain, 'rpcUrls'>; prividiumApiBaseUrl: string }): Chain {
    return {
        ...mainnet,
        ...config.chain,
        id: config.chain.id,
        contracts: {
            ...config.chain.contracts,
            multicall3: undefined // Prividium™ doesn't support multicall yet
        },
        rpcUrls: { default: { http: [rpcUrl(config.prividiumApiBaseUrl)] } },
        blockExplorers: config.chain.blockExplorers
    };
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiCaller = <Schema extends ZodType>(
    schema: Schema,
    url: string,
    method: HttpMethod,
    body?: string
) => Promise<z.infer<Schema>>;

export function createApiMethods(deps: { prividiumApiCall: ApiCaller; prividiumApiBaseUrl: string }) {
    const { prividiumApiCall, prividiumApiBaseUrl } = deps;

    return {
        async fetchUser(): Promise<UserProfile> {
            // profileResponseSchema accepts the current shape and older name-keyed ones, normalizing to
            // the latest (see types.ts).
            return await prividiumApiCall(profileResponseSchema, `${prividiumApiBaseUrl}/api/profiles/me`, 'GET');
        },

        async getWalletToken(): Promise<string> {
            const { token } = await prividiumApiCall(
                z.object({ token: z.string() }),
                `${prividiumApiBaseUrl}/api/wallet/personal-rpc-token`,
                'GET'
            );
            return token;
        },

        async getWalletRpcUrl(): Promise<string> {
            const walletToken = await this.getWalletToken();
            return walletRpcUrl(prividiumApiBaseUrl, walletToken);
        },

        async invalidateWalletToken(): Promise<string> {
            const { newWalletToken } = await prividiumApiCall(
                z.object({ newWalletToken: z.string(), message: z.string() }),
                `${prividiumApiBaseUrl}/api/wallet/invalidate`,
                'POST'
            );
            return newWalletToken;
        },

        async authorizeTransaction(params: AuthorizeTransactionParams): Promise<AuthorizeTransactionResponse> {
            return prividiumApiCall(
                authorizeTransactionResponseSchema,
                `${prividiumApiBaseUrl}/api/wallet/transaction-authorization`,
                'POST',
                JSON.stringify({
                    ...params,
                    // Always pass calldata and value, even if undefined
                    calldata: params?.calldata ?? '0x',
                    value: params.value?.toString() ?? '0'
                })
            );
        },

        async fetchContractAbi(contractAddress: string): Promise<ContractAbiResponse> {
            return prividiumApiCall(
                contractAbiResponseSchema,
                `${prividiumApiBaseUrl}/api/contracts/${contractAddress}/abi`,
                'GET'
            );
        }
    };
}
