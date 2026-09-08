// Types mirror the permissions-api OpenAPI spec at /api/users/{id} and /api/contracts.
// Hand-written so the published declarations are self-contained. The alignment test at
// src/admin-api/types-alignment.test.ts cross-checks these against the workspace
// OpenAPI-generated types and fails typecheck on drift.

export type AdminUserSource = 'oidc' | 'adminPanel' | 'tenant' | 'crypto_native' | 'm2m_app';

export type AdminSystemPermission =
    | 'contract_deployment'
    | 'full_sequencer_rpc_access'
    | 'full_read_access'
    | 'admin_read'
    | 'admin_write'
    | 'org_users_manage'
    | 'org_wallets_manage'
    | 'org_rpc_access'
    | 'org_policy_access'
    | 'rpc_read_eth_getBlockByNumber'
    | 'rpc_read_eth_getLogs'
    | 'rpc_read_eth_getTransactionByHash'
    | 'rpc_read_eth_getTransactionReceipt'
    | 'check_user_read_access'
    | 'contract_metadata_read';

export interface AdminUserRole {
    // Stable role identifier and the functional key for role operations (assigning, filtering).
    id: string;
    // Human-readable label only. Not unique across organizations and not a valid role reference.
    roleName: string;
    systemPermissions?: Array<AdminSystemPermission>;
    isSystemRole?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface AdminUserWallet {
    id: number;
    walletAddress: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
}

export interface AdminUserOrganization {
    id: string;
    name: string;
}

export interface AdminUser {
    id: string;
    displayName: string;
    source: AdminUserSource;
    createdAt: string;
    updatedAt: string;
    organization: AdminUserOrganization | null;
    roles: Array<AdminUserRole>;
    wallets: Array<AdminUserWallet>;
}

// Wire body for PUT /users/{id}: a full replacement, so every field is required. `roles` is the
// list of role ids the server assigns verbatim.
export interface AdminUserUpdate {
    displayName: string;
    roles: Array<string>;
    wallets: Array<string>;
}

// Input accepted by users.update(): any subset of the editable fields. Omitted fields are preserved
// by fetching the current user and merging before the full-replacement PUT.
//
// `roles` takes role references ({ id } — exactly what reads return), not bare strings, so passing a
// role *name* where an id is required is a compile error instead of silently clearing the user's roles.
export interface AdminUserUpdateInput {
    displayName?: string;
    roles?: Array<Pick<AdminUserRole, 'id'>>;
    wallets?: Array<string>;
}

export interface AdminDisclosedAddress {
    address: string;
}

export interface AdminContract {
    contractAddress: string;
    abi: string;
    name: string | null;
    description: string | null;
    discloseErc20TotalSupply: boolean;
    discloseBytecode: boolean;
    templateId: number | null;
    isSystemContract: boolean;
    organizationId: string | null;
    disclosedAddresses: Array<AdminDisclosedAddress>;
    createdAt: string;
    updatedAt: string;
    disclosureStartBlock: string;
}

export interface AdminContractCreate {
    contractAddress: string;
    abi: string;
    name: string | null;
    description: string | null;
    discloseErc20TotalSupply?: boolean;
    discloseBytecode?: boolean;
    disclosedAddresses?: Array<AdminDisclosedAddress>;
    templateId?: number | null;
    templateKey?: string | null;
    organizationId?: string | null;
    disclosureStartBlock: string;
}
