/**
 * JSON-RPC error codes used in Prividium API.
 * Standard codes follow JSON-RPC 2.0 spec, custom codes handle auth/authz.
 * @see /docs/rpc_error_codes.md
 */

/**
 * Internal error (-32603). Standard JSON-RPC 2.0 code for server errors.
 */
export const INTERNAL_RPC_ERROR = -32603;

/**
 * Invalid Request (-32600). Standard JSON-RPC 2.0 code for malformed requests.
 */
export const INVALID_REQUEST_ERROR_CODE = -32600;

/**
 * Invalid params (-32602). Standard JSON-RPC 2.0 code for bad parameters.
 */
export const BAD_RPC_PARAMS_ERROR_CODE = -32602;

/**
 * Method not found (-32601). Standard JSON-RPC 2.0 code for unknown/unavailable methods.
 */
export const METHOD_NOT_FOUND_ERROR_CODE = -32601;

/**
 * Unauthorized (-32090). Custom code for authentication failures (no/invalid token).
 */
export const UNAUTHORIZED_ERROR_CODE = -32090;

/**
 * Forbidden (-32001). Custom code for authorization failures (valid token, insufficient permissions).
 */
export const FORBIDDEN_ERROR_CODE = -32001;

/**
 * EIP-7966 sync-send timeout (4). Returned by the chain's
 * `eth_sendRawTransactionSync` when the tx is admitted to the mempool but
 * doesn't land in a block within the sync deadline. The tx may still mine;
 * callers should poll `eth_getTransactionReceipt`.
 */
export const EIP_7966_TIMEOUT_CODE = 4;

/**
 * Sequencer rate limit (-32005). The chain refused to admit the tx and asks the
 * caller to retry; `data.retryAfterMs` carries the suggested delay. Emitted for
 * both the request-rate and executed-gas limiters — the envelope does not say
 * which, and neither is a rejection of the tx itself.
 */
export const SEQUENCER_RATE_LIMIT_ERROR_CODE = -32005;

/**
 * Zeroed-out logsBloom value (256 bytes = 512 hex chars + '0x' prefix).
 * Used to redact bloom filter data from block and receipt responses
 * when the user does not have full read access, preventing information
 * leakage about emitted events and indexed topics.
 */
export const ZERO_LOGS_BLOOM =
    '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as const;
