// Core factory + types

// Admin API namespace types
export type {
    AdminContract,
    AdminContractCreate,
    AdminMethods,
    AdminUser,
    AdminUserUpdate,
    AdminUserUpdateInput,
    ContractsAdminMethods,
    UsersAdminMethods
} from './admin-api/index.js';
// Viem client (reusable with SIWE chain)
export { createPrividiumClient } from './create-prividium-client.js';
// Storage (MemoryStorage is the default for SIWE, but expose both + interface)
export { MemoryStorage } from './memory-storage.js';
export { FORBIDDEN_ERROR_CODE, METHOD_NOT_FOUND_ERROR_CODE, UNAUTHORIZED_ERROR_CODE } from './rpc-error-codes.js';
export type { SiweAuthConfig } from './siwe-auth.js';
// Auth strategy
export { SiweAuth } from './siwe-auth.js';
export type { PrividiumSiweChain, PrividiumSiweConfig } from './siwe-chain.js';
export { createPrividiumSiweChain } from './siwe-chain.js';
export { TokenManager } from './storage.js';
// Shared types needed by consumers
export type {
    AuthorizeTransactionParams,
    AuthorizeTransactionResponse,
    Storage,
    TokenData,
    UserProfile,
    UserRole
} from './types.js';
export { AUTH_ERRORS } from './types.js';
// Stateless user-token verification helper
export type {
    UserTokenVerifyError,
    UserTokenVerifyResult,
    VerifyUserAccessTokenOptions
} from './verify-user-access-token.js';
export { verifyUserAccessToken } from './verify-user-access-token.js';
