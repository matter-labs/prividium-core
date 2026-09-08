import type { Address, Chain, Hex, Transport } from 'viem';
import { z } from 'zod';

export type OauthScope = 'wallet:required' | 'network:required';

export interface Storage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * Passed to {@link PrividiumConfig.onSessionExpiring} when the session is about to expire.
 */
export interface SessionExpiringInfo {
    /** The idle (or fixed) expiry deadline for the current session. */
    expiresAt: Date;
    /** The hard cap beyond which the session cannot be extended. */
    renewableUntil: Date;
    /** Approximate seconds until the session expires. */
    secondsRemaining: number;
    /**
     * `true` when the session uses idle-timeout mode and can still be extended
     * (i.e. `expiresAt < renewableUntil`).
     */
    canExtend: boolean;
    /** Extends the session by posting to `/api/auth/extend-session`. */
    extend: () => Promise<void>;
}

export interface PrividiumConfig {
    clientId: string;
    chain: Omit<Chain, 'rpcUrls'>;
    authBaseUrl: string;
    redirectUrl: string;
    /**
     * Local development/testing only. Selects an organization so the auth popup shows that
     * organization's branding and routes login to its identity provider (forwarded to the User
     * Panel as `?org=<id>`). In production the domain serving the User Panel determines the
     * organization and overrides this value.
     */
    org?: string;
    /**
     * @deprecated use the `prividiumApiBaseUrl` field instead
     */
    permissionsApiBaseUrl?: string;
    prividiumApiBaseUrl: string;
    storage?: Storage;
    onAuthExpiry?: () => void;
    /**
     * Called when the session is approaching expiry. The scheduler invokes
     * this at `warningLeadTime` ms before `expiresAt`. Receive a
     * {@link SessionExpiringInfo} object to optionally prompt the user or extend the
     * session programmatically.
     */
    onSessionExpiring?: (info: SessionExpiringInfo) => void;
    /**
     * How often (in ms) the scheduler polls the session expiry deadline.
     * Defaults to `300000` (5 minutes).
     */
    idleCheckInterval?: number;
    /**
     * How many ms before `expiresAt` the scheduler fires `onSessionExpiring`.
     * Defaults to `60000` (60 seconds).
     */
    warningLeadTime?: number;
}

export const roleSchema = z.object({
    id: z.string(),
    roleName: z.string()
});

export type UserRole = z.infer<typeof roleSchema>;

export const profileSchema = z.object({
    id: z.string(),
    createdAt: z.coerce.date(),
    displayName: z.string(),
    updatedAt: z.coerce.date(),
    roles: roleSchema.array(),
    wallets: z.unknown().array()
});

export type UserProfile = z.infer<typeof profileSchema>;

// Versioned profile response shapes, following cli/server/config-file.ts (see admin-api/schemas.ts for
// the same treatment of the admin user): `latest` is the current shape; each `v<X_Y>` entry is an
// older shape kept so the SDK keeps working against a server that predates a change.
// `profileResponseSchema` parses `latest` first, then older shapes, normalizing to `latest`.
const profileResponseShapes = {
    latest: profileSchema,
    // <= v1.260 (pre-surrogate-id): roles are keyed by name, so `id` is absent.
    v1_260: profileSchema.extend({ roles: roleSchema.extend({ id: z.string().optional() }).array() })
} as const;

export const profileResponseSchema = z.union([
    profileResponseShapes.latest,
    profileResponseShapes.v1_260.transform(
        (profile): UserProfile => ({
            ...profile,
            roles: profile.roles.map((role) => ({ ...role, id: role.id ?? role.roleName }))
        })
    )
]);

export interface AddNetworkParams {
    chainName?: string;
    chainId: string;
    nativeCurrency?: {
        name: string;
        symbol: string;
        decimals: number;
    };
    blockExplorerUrls?: string[];
}

export type AuthorizeTransactionParams =
    | {
          walletAddress: Address;
          toAddress: Address;
          nonce: number;
          calldata: Hex;
          value: bigint;
      }
    | {
          walletAddress: Address;
          toAddress: Address;
          nonce: number;
          calldata: Hex;
          value?: never;
      }
    | {
          walletAddress: Address;
          toAddress: Address;
          nonce: number;
          calldata?: never;
          value: bigint;
      };

export const authorizeTransactionResponseSchema = z.object({
    message: z.string(),
    activeUntil: z.string()
});

export type AuthorizeTransactionResponse = z.infer<typeof authorizeTransactionResponseSchema>;

const methodSelectorSchema = z.string().regex(/^0x[0-9a-fA-F]{8}$/, 'Invalid method selector format');

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/i, 'Invalid address format');

export const contractAbiResponseSchema = z.object({
    contractAddress: addressSchema,
    name: z.string().nullable(),
    abi: z.array(z.record(z.string(), z.unknown())),
    functions: z.array(
        z.object({
            selector: methodSelectorSchema,
            signature: z.string(),
            name: z.string(),
            accessType: z.enum(['read', 'write'])
        })
    )
});

export type ContractAbiResponse = z.infer<typeof contractAbiResponseSchema>;

export interface PrividiumChain {
    chain: Chain;
    transport: Transport;
    authorize(opts?: PopupOptions): Promise<string>;
    unauthorize(): void;
    isAuthorized(): boolean;
    getAuthHeaders(): Record<string, string> | null;
    fetchUser(): Promise<UserProfile>;
    getWalletToken(): Promise<string>;
    getWalletRpcUrl(): Promise<string>;
    invalidateWalletToken(): Promise<string>;
    authorizeTransaction(params: AuthorizeTransactionParams): Promise<AuthorizeTransactionResponse>;
    addNetworkToWallet(params?: AddNetworkParams): Promise<void>;
    fetchContractAbi(contractAddress: Address): Promise<ContractAbiResponse>;
}

export const tokenDataSchema = z.object({
    rawToken: z.string(),
    expiresAt: z.coerce.date(),
    renewableUntil: z.coerce.date()
});

export interface TokenData {
    rawToken: string;
    expiresAt: Date;
    renewableUntil: Date;
}

export interface PopupOptions {
    popupSize?: { w: number; h: number };
    scopes?: OauthScope[];
}

export const AUTH_ERRORS = {
    INVALID_STATE: 'Invalid state parameter',
    NO_RECEIVED_STATE: 'No state parameter',
    NO_SAVED_STATE: 'No saved state',
    NO_TOKEN: 'No token received',
    EXPIRED_TOKEN: 'Expired token',
    INVALID_JWT: 'Invalid JWT format',
    AUTH_REQUIRED: 'Authentication required'
} as const;

export const STORAGE_KEYS = {
    STATE_PREFIX: 'prividium_auth_state_',
    TOKEN_PREFIX: 'prividium_token_'
} as const;
