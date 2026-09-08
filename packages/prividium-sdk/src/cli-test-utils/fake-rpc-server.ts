import fastify from 'fastify';

export type JsonRpcRequest = {
    jsonrpc?: '2.0';
    id: number | string | null;
    method: string;
    params?: unknown;
};

export type RpcHandler = (params: unknown[]) => unknown | Promise<unknown>;

export type RpcError = { code: number; message: string; data?: unknown };

export class RpcMethodError extends Error {
    constructor(public readonly rpcError: RpcError) {
        super(rpcError.message);
    }
}

export type FakeRpcServer = {
    url: string;
    close: () => Promise<void>;
    requests: JsonRpcRequest[];
};

export async function startFakeRpc(handlers: Record<string, RpcHandler>): Promise<FakeRpcServer> {
    const requests: JsonRpcRequest[] = [];
    const app = fastify();

    const rpcHandler = async (req: { body: unknown }) => {
        const payload = req.body as JsonRpcRequest;
        requests.push(payload);

        const id = payload.id ?? null;
        const handler = handlers[payload.method];

        if (!handler) {
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${payload.method}` } };
        }

        const params = Array.isArray(payload.params) ? payload.params : [];
        return { jsonrpc: '2.0', id, result: await handler(params) };
    };

    // The CLI's prividium client targets `<apiUrl>/rpc`; L1/L2 viem clients hit the bare URL.
    // Register both so a single fake can stand in for either role.
    app.post('/', rpcHandler);
    app.post('/rpc', rpcHandler);

    const url = await app.listen({ host: '127.0.0.1', port: 0 });

    return { url, requests, close: () => app.close() };
}
