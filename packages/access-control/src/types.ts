export type Permission =
    | 'contract_deployment'
    | 'full_sequencer_rpc_access'
    | 'full_read_access'
    | 'rpc_read_eth_getBlockByNumber'
    | 'rpc_read_eth_getLogs'
    | 'rpc_read_eth_getTransactionByHash'
    | 'rpc_read_eth_getTransactionReceipt'
    | 'admin_read'
    | 'admin_write'
    | 'org_users_manage'
    | 'org_wallets_manage'
    | 'org_rpc_access'
    | 'check_user_read_access'
    | 'contract_metadata_read';

declare const featurePermissionBrand: unique symbol;

/** A permission a feature outside the core owns. Minted only by `defineFeaturePermission` in `@repo/api-kit`. */
export type FeaturePermissionName = string & { readonly [featurePermissionBrand]: true };

/** A permission a caller can be checked for: the core's own, or one a registered feature declared. */
export type SystemPermissionName = Permission | FeaturePermissionName;

export type RoleHolder = {
    roles: {
        id: string;
        roleName: string;
        organizationId: string | null;
        /** Stored names, which may include a feature's permission this deployment does not register. */
        systemPermissions?: readonly string[];
    }[];
};

// User type based on the API response shape
// Defined locally to avoid circular dependency with @repo/api-types
export type User = Pick<RoleHolder, 'roles'> & {
    source: 'oidc' | 'adminPanel' | 'tenant' | 'crypto_native' | 'm2m_app';
};
