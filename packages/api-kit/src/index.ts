export type { AddressClass, CoreFacts, CoreReferences, SigningIdentity } from './core-facts';
export { AUDIT_SESSION_VARS, clearAuditSessionVars, setAuditSessionVarsSql } from './db/audit-session';
export { createDbPool, type DbLogger, type RawTx, withJobContext } from './db/client';
export { createdAt, publicId, timestampTz, updatedAt } from './db/common-schema';
export {
    addressColumn,
    hexBigInt,
    hexBigIntColumn,
    hexBytes,
    hexBytesColumn,
    methodSelectorColumn,
    uint256,
    uint256Column
} from './db/custom-types';
export {
    createInsertSchema,
    createSelectSchema,
    createUpdateSchema,
    MANAGED_COLUMNS,
    TIMESTAMP_COLUMNS
} from './db/drizzle-zod-schema-factory';
export {
    type EntityConfig,
    entityRepositoryOn,
    type QueryOptions
} from './db/entity-repository';
export {
    extractForeignKeyConstraintProblem,
    isForeignKeyConstraintError,
    isNoValuesToSetError,
    isPostgresError,
    isUniqueConstraintError,
    PostgresError
} from './db/errors';
export { paginate } from './db/paginate';
export { escapeLike, getFirst, getFirstOrThrow } from './db/utils';
export {
    ChainUnavailableError,
    ConflictError,
    EntityAlreadyExistsError,
    EntityNotFound,
    ForbiddenError,
    InternalServerError,
    InvalidEntity,
    InvalidInputError,
    OrgQuotaExceededError,
    PermissionApiError,
    RateLimitError,
    ServiceOverloadedError,
    UnauthorizedError,
    UnexpectedDbError,
    WalletLimitExceededError,
    WalletNotLinkedError
} from './error-types';
export {
    type AuthorizationOverlay,
    OVERLAY_UNAVAILABLE,
    type OverlayFrame,
    OverlayRefusal,
    type OverlayRuleId,
    type OverlaySubject,
    type OverlayTraceSubject,
    type OverlayVerdict
} from './http/authorization-overlay';
export { type ApiServerOptions, createApiServer, registerNotFoundHandler } from './http/build-server';
export { createErrorHandler, type ErrorHandler, type ErrorHandlerOptions } from './http/error-handler';
export type {
    AuthenticatedPrincipal,
    CallerKind,
    FeatureAuditContext,
    FeatureAuditEventDetails,
    OrgSurfaceOptions,
    RequestAuthGuards,
    RequestHook
} from './http/feature-host';
export { type RequestContextOptions, type RequestHookHost, registerRequestContext } from './http/request-context';
export {
    type AdmitDenial,
    type AdmitDeniedHook,
    RPC_ACTOR_TYPES,
    type RpcActorContext,
    type RpcActorType,
    type RpcDenial,
    type RpcObserver,
    type RpcObserverFactory,
    type RpcOrigin,
    rpcActorTypeSchema
} from './rpc-observer';
export { addressSchema } from './schemas/address';
export {
    type ErrorResponse,
    ErrorResponseSchema,
    PaginationQuerySchema,
    PublicIdSchema,
    SearchQuerySchema
} from './schemas/fastify-common';
export {
    hexSchema,
    hexSizedSchema,
    type MethodSelector,
    methodSelectorSchema,
    u256HexSchema
} from './schemas/hex-schema';
export { type PaginatedResult, type PaginationParams, paginatedResult } from './schemas/pagination';
export type { SiweConfig } from './siwe-config';
export { stableStringify } from './stable-stringify';
export { extractSelector } from './utils/extract-selector';
export { areHexEqual, hexListIncludes, hexToBigIntKey } from './utils/hex';
