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
    | 'org_policy_access'
    | 'check_user_read_access'
    | 'contract_metadata_read';

export type RoleHolder = {
    roles: {
        id: string;
        roleName: string;
        organizationId: string | null;
        systemPermissions?: Permission[];
    }[];
};

// User type based on the API response shape
// Defined locally to avoid circular dependency with @repo/api-types
export type User = Pick<RoleHolder, 'roles'> & {
    source: 'oidc' | 'adminPanel' | 'tenant' | 'crypto_native' | 'm2m_app';
};
