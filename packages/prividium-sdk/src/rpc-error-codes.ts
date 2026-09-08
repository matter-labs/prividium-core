/**
 * RPC error codes used in Prividium SDK.
 * Standard codes follow JSON-RPC 2.0 spec, custom codes handle auth/authz.
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
 * Method not found (-32601). Standard JSON-RPC 2.0 code for unknown/unavailable methods.
 */
export const METHOD_NOT_FOUND_ERROR_CODE = -32601;

/**
 * Invalid params (-32602). Standard JSON-RPC 2.0 code for bad parameters.
 */
export const BAD_RPC_PARAMS_ERROR_CODE = -32602;

/**
 * Unauthorized (-32090). Custom code for authentication failures (no/invalid token).
 */
export const UNAUTHORIZED_ERROR_CODE = -32090;

/**
 * Forbidden (-32001). Custom code for authorization failures (valid token, insufficient permissions).
 */
export const FORBIDDEN_ERROR_CODE = -32001;
