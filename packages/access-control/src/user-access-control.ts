import { createPermix, type PermixDefinition } from 'permix';
import { hasSystemPermission, hasZoneSystemPermission } from './helpers';
import type { Permission, RoleHolder, User } from './types';

const RPC_PERMISSION_BY_METHOD = {
    eth_getBlockByNumber: 'rpc_read_eth_getBlockByNumber',
    eth_getLogs: 'rpc_read_eth_getLogs',
    eth_getTransactionByHash: 'rpc_read_eth_getTransactionByHash',
    eth_getTransactionReceipt: 'rpc_read_eth_getTransactionReceipt'
} as Record<string, Permission>;

export type UserAccessControlDefinition = PermixDefinition<{
    wallets: {
        action: 'associate';
    };
    sequencer: {
        action: 'fullAccess' | 'fullReadAccess' | 'deployment';
    };
    rpcMethod: {
        dataType: string;
        dataRequired: true;
        action: 'unrestrictedRead';
    };
}>;

export { createPermix };

export const userPermix = createPermix<UserAccessControlDefinition>();

export const userAccessControl = userPermix.template((user: User) => ({
    wallets: {
        associate: user.source !== 'tenant'
    },
    sequencer: sequencerAccessControl({ roles: user.roles }),
    rpcMethod: rpcMethodsAccessControl({ roles: user.roles })
}));

export function sequencerAccessControl(roleHolder: RoleHolder) {
    return {
        // Zone-wide read/write only applies to zone-level principals; an org-scoped holder of these
        // permissions is confined to its organization and must not get full access here.
        fullAccess: hasZoneSystemPermission(roleHolder, 'full_sequencer_rpc_access'),
        fullReadAccess: hasZoneSystemPermission(roleHolder, 'full_read_access'),
        // Deployments are allowed for both, zone and organization users.
        deployment:
            hasSystemPermission(roleHolder, 'contract_deployment') ||
            hasSystemPermission(roleHolder, 'full_sequencer_rpc_access')
    };
}

export function rpcMethodsAccessControl(roleHolder: RoleHolder) {
    return {
        unrestrictedRead: (methodName: string) => {
            const permission = RPC_PERMISSION_BY_METHOD[methodName];
            return !!permission && hasZoneSystemPermission(roleHolder, permission);
        }
    };
}

export const userForbiddenAccessControl = userPermix.template({
    wallets: {
        associate: false
    },
    sequencer: {
        fullAccess: false,
        fullReadAccess: false,
        deployment: false
    },
    rpcMethod: {
        unrestrictedRead: false
    }
});
