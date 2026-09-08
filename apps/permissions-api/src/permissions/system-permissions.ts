// Import via subpath — the package index pulls in ESM-only permix and breaks `db:generate`.
import { ORG_ADMIN_GRANTABLE_PERMISSIONS } from '@repo/access-control/src/constants';
import { z } from 'zod/v4';

export const ALL_SYSTEM_PERMISSIONS = [
    'contract_deployment',
    'full_sequencer_rpc_access',
    'full_read_access',
    'admin_read',
    'admin_write',
    'org_users_manage',
    'org_wallets_manage',
    'org_rpc_access',
    'org_policy_access',
    'rpc_read_eth_getBlockByNumber',
    'rpc_read_eth_getLogs',
    'rpc_read_eth_getTransactionByHash',
    'rpc_read_eth_getTransactionReceipt',
    'check_user_read_access',
    'contract_metadata_read'
] as const;
export const SystemPermissions = z.enum(ALL_SYSTEM_PERMISSIONS);
export type SystemPermission = z.infer<typeof SystemPermissions>;

// The org-admin grantable ceiling lives in @repo/access-control so the admin UI restricts its role
// picker to the same set the API enforces here. Re-exported for existing importers of this module.
export { ORG_ADMIN_GRANTABLE_PERMISSIONS };

const orgGrantablePermissions = new Set<string>(ORG_ADMIN_GRANTABLE_PERMISSIONS);

/** Returns the permissions in the list that an org admin is NOT allowed to grant (empty = all allowed). */
export function permissionsOutsideOrgCeiling(permissions: readonly string[]): string[] {
    return permissions.filter((permission) => !orgGrantablePermissions.has(permission));
}
