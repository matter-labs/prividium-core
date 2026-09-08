import { type ZodType, z } from 'zod/v4';
import { INVALID_REQUEST_ERROR_CODE, METHOD_NOT_FOUND_ERROR_CODE } from './constants';

export type JsonRpcRequest = {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params: unknown[];
};

export type JsonRpcResponse = {
    jsonrpc: '2.0';
} & (
    | {
          id: number | string;
          result: JSONLike;
      }
    | {
          id: number | string | null;
          error: JsonRpcError;
      }
);

export type JsonRpcError = {
    code: number;
    message: string;
    data?: unknown;
};

const jsonSchema = z.union([
    z.record(
        z.string(),
        z.lazy((): ZodType => jsonSchema)
    ),
    z.string(),
    z.number(),
    z.null(),
    z.boolean(),
    z.array(z.lazy((): ZodType => jsonSchema))
]);

export type JSONLike = z.infer<typeof jsonSchema>;

/**
 * Creates invalid request error response. Uses error code -32600.
 */
export function invalidRequest(id: JsonRpcResponse['id']): JsonRpcResponse {
    return {
        jsonrpc: '2.0',
        id,
        error: { code: INVALID_REQUEST_ERROR_CODE, message: 'Invalid Request' }
    };
}

export function request({
    id,
    method,
    params
}: {
    id: JsonRpcRequest['id'];
    method: JsonRpcRequest['method'];
    params: JsonRpcRequest['params'];
}): JsonRpcRequest {
    return {
        jsonrpc: '2.0',
        id,
        method,
        params
    };
}

export function response({
    id,
    result
}: {
    id: Exclude<JsonRpcResponse['id'], null>;
    result: JSONLike;
}): JsonRpcResponse {
    return {
        jsonrpc: '2.0',
        id,
        result
    };
}

export function errorResponse({ id, error }: { id: JsonRpcResponse['id']; error: JsonRpcError }): JsonRpcResponse {
    return {
        jsonrpc: '2.0',
        id,
        error
    };
}

export function bundlerNotEnabledResponse(id: JsonRpcResponse['id']): JsonRpcResponse {
    return errorResponse({
        id,
        error: { message: 'Bundler is not enabled', code: METHOD_NOT_FOUND_ERROR_CODE }
    });
}

export const rpcRequestSchema = z.object({
    id: z.union([z.string(), z.number()]),
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: z.array(z.unknown()).optional()
});

export const requestOrBatch = z.union([rpcRequestSchema, rpcRequestSchema.array()]);

// Rate limiting is per request, so batch items are otherwise unmetered. 1000 matches geth's default.
export const MAX_RPC_BATCH_SIZE = 1000;
