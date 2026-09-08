export abstract class PermissionApiError extends Error {
    abstract get code(): string;
    abstract get statusCode(): number;
}

export class EntityAlreadyExistsError extends PermissionApiError {
    code = 'ENTITY_ALREADY_EXISTS';
    statusCode = 409;
}

/** Optimistic-concurrency rejection: the caller acted on a stale read of the resource. */
export class ConflictError extends PermissionApiError {
    code = 'CONFLICT';
    statusCode = 409;
}

export class EntityNotFound extends PermissionApiError {
    code = 'NOT_FOUND';
    statusCode = 404;
    constructor(entityType: string, details?: Record<string, string | number>) {
        const parts = Object.entries(details ?? {}).map(([k, v]) => `${k} "${v}"`);
        super(parts.length > 0 ? `${entityType} with ${parts.join(', ')} not found` : `${entityType} not found`);
    }
}

export class InvalidInputError extends PermissionApiError {
    code = 'INVALID_INPUT_ERROR';
    statusCode = 400;
}

export class InvalidEntity extends PermissionApiError {
    code = 'INVALID_ENTITY';
    statusCode = 422;
}

export class OrgQuotaExceededError extends PermissionApiError {
    code = 'ORG_QUOTA_EXCEEDED';
    statusCode = 409;
    constructor(limit: number) {
        super(`Organization quota reached (limit: ${limit})`);
    }
}

export class WalletLimitExceededError extends PermissionApiError {
    code = 'WALLET_LIMIT_EXCEEDED';
    statusCode = 409;
    constructor(limit: number) {
        super(`Wallet limit per user reached (limit: ${limit})`);
    }
}

export class ForbiddenError extends PermissionApiError {
    code = 'FORBIDDEN_ERROR';
    statusCode = 403;
    constructor(msg?: string) {
        super(msg || 'Forbidden access');
    }
}

export class UnauthorizedError extends PermissionApiError {
    code = 'UNAUTHORIZED_ERROR';
    statusCode = 401;
    constructor(msg?: string) {
        super(msg || 'Unauthorized');
    }
}

/**
 * SIWE login rejection for a wallet with no linked user account. The specific message and code are
 * safe to disclose: the SIWE signature is verified before the user lookup, so they only ever reach
 * the proven owner of the address (no enumeration risk). The distinct code lets the user panel
 * disconnect the dead-end wallet instead of offering it for retry. Subclasses UnauthorizedError so
 * `instanceof` checks (e.g. the auth.login_failed audit logging) keep treating it as a 401 rejection.
 */
export class WalletNotLinkedError extends UnauthorizedError {
    override code = 'WALLET_NOT_LINKED';
    constructor() {
        super('This wallet is not linked to an account.');
    }
}

export class RateLimitError extends PermissionApiError {
    code = 'RATE_LIMIT_ERROR';
    statusCode = 429;
    /** Seconds the client should wait before retrying. The error handler emits this as a `Retry-After` header. */
    readonly retryAfterSeconds?: number;

    constructor(msg: string, opts?: { retryAfterSeconds?: number }) {
        super(msg);
        this.retryAfterSeconds = opts?.retryAfterSeconds;
    }
}

/** The chain RPC did not answer, so a check that depends on on-chain state could not be made. */
export class ChainUnavailableError extends PermissionApiError {
    code = 'CHAIN_UNAVAILABLE';
    statusCode = 503;

    constructor(msg?: string, options?: ErrorOptions) {
        super(msg || 'Chain RPC is unavailable', options);
    }
}

export class ServiceOverloadedError extends PermissionApiError {
    code = 'SERVICE_OVERLOADED';
    statusCode = 503;

    constructor(msg?: string) {
        super(msg || 'Service temporarily overloaded');
    }
}

export class InternalServerError extends PermissionApiError {
    code = 'INTERNAL_SERVER_ERROR';
    statusCode = 500;

    constructor(msg?: string) {
        super(msg || 'Internal server error');
    }
}

/**
 * This error extends from plain js `Error` because when this happens
 * we don't want to leak any detail to the user. The message is logged as
 * a generic error and that's it.
 */
export class UnexpectedDbError extends Error {}
