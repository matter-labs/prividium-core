import type { RuleId } from '../services/authorization-service';
import {
    BAD_RPC_PARAMS_ERROR_CODE,
    FORBIDDEN_ERROR_CODE,
    INVALID_REQUEST_ERROR_CODE,
    METHOD_NOT_FOUND_ERROR_CODE,
    UNAUTHORIZED_ERROR_CODE
} from './constants';

/**
 * Base exception for RPC errors.
 * All RPC exceptions return as JSON-RPC 2.0 error responses (HTTP 200 status).
 */
export class RpcException extends Error {
    code: number;
    data: unknown;
    reason: string;
    constructor(message: string, code: number, reason?: string, data?: unknown) {
        super(message);
        this.code = code;
        this.data = data;
        this.reason = reason ?? 'unknown';
    }
}

/**
 * Thrown when user is not authenticated (missing or invalid auth token).
 * Returns error code -32090 (custom Prividium code).
 */
export class UnauthorizedRpcError extends RpcException {
    constructor(reason?: string) {
        super('Unauthorized', UNAUTHORIZED_ERROR_CODE, reason);
    }
}

/**
 * Thrown when user is authenticated but lacks permission for the requested action.
 * Returns error code -32001 (custom Prividium code).
 */
export class ForbiddenRpcError extends RpcException {
    /**
     * Authorization rule that produced the denial. Read only by the denial
     * ledger — never serialized into JSON-RPC responses.
     */
    ruleId?: RuleId;
    constructor(message = 'Forbidden', reason?: string, data?: unknown, ruleId?: RuleId) {
        super(message, FORBIDDEN_ERROR_CODE, reason, data);
        this.ruleId = ruleId;
    }
}

/**
 * Thrown when RPC method receives invalid parameters.
 * Returns error code -32602.
 */
export class WrongArguments extends RpcException {
    constructor(msg?: string) {
        super(msg ?? 'Invalid arguments', BAD_RPC_PARAMS_ERROR_CODE);
    }
}

/**
 * Thrown when RPC method receives invalid parameters.
 * Returns error code -32602.
 */
export class InvalidRpcRequest extends RpcException {
    constructor(msg?: string, reason?: string) {
        super(msg ?? 'Invalid request', INVALID_REQUEST_ERROR_CODE, reason);
    }
}

export class RpcMethodNotFound extends RpcException {
    constructor(msg?: string, reason?: string) {
        super(msg ?? 'Method not found', METHOD_NOT_FOUND_ERROR_CODE, reason);
    }
}
