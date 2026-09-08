import { getThrownReason } from '../utils.js';

export type RpcResponse = {
    result?: string;
    error?: {
        code: number;
        message: string;
    };
};

type RpcCallOptions = {
    method: string;
    params?: unknown[];
    path?: string;
    token?: string;
};

export async function callRpc(
    apiBaseUrl: string,
    { method, params = [], path = '/rpc', token }: RpcCallOptions
): Promise<RpcResponse> {
    try {
        const response = await fetch(new URL(path, apiBaseUrl), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                id: method,
                jsonrpc: '2.0',
                method,
                params
            })
        });

        if (!response.ok) {
            return {
                error: {
                    code: response.status,
                    message: await response.text()
                }
            };
        }

        return (await response.json()) as RpcResponse;
    } catch (error) {
        return {
            error: {
                code: -1,
                message: getThrownReason(error)
            }
        };
    }
}

export async function requireRpcResult(apiBaseUrl: string, options: RpcCallOptions): Promise<string> {
    const rpcResponse = await callRpc(apiBaseUrl, options);
    if (rpcResponse.error || rpcResponse.result === undefined) {
        throw new Error(formatRpcError(options.method, rpcResponse));
    }

    return rpcResponse.result;
}

export async function requireForbiddenRpc(apiBaseUrl: string, options: RpcCallOptions): Promise<void> {
    const rpcResponse = await callRpc(apiBaseUrl, options);
    if (!rpcResponse.error) {
        throw new Error(`RPC method unexpectedly allowed on ${options.method}`);
    }

    if (!isForbiddenRpc(rpcResponse)) {
        throw new Error(formatRpcError(options.method, rpcResponse));
    }
}

export function formatRpcError(method: string, rpcResponse: RpcResponse): string {
    if (rpcResponse.error) {
        return `RPC ${rpcResponse.error.code}: ${rpcResponse.error.message} on ${method}`;
    }

    return `RPC unknown: invalid response on ${method}`;
}

export function isForbiddenRpc(rpcResponse: RpcResponse): boolean {
    return rpcResponse.error?.code === 403 || rpcResponse.error?.message.toLowerCase().includes('forbidden') || false;
}
