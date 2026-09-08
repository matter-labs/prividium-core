import {
    createPermix,
    rpcMethodsAccessControl,
    sequencerAccessControl,
    type UserAccessControlDefinition,
    userAccessControl
} from '@repo/access-control';
import type { Permix } from 'permix';
import type { M2mApplication } from '../repositories/m2m-applications-repository';
import type { Tenant } from '../repositories/tenants-repository';
import type { UserWithRoles } from '../repositories/users-repository';

export function prividiumPermix(user: UserWithRoles): Permix<UserAccessControlDefinition> {
    return createPermix<UserAccessControlDefinition>(userAccessControl(user));
}

export function permixForM2mApp(m2mApp: M2mApplication) {
    return createPermix<UserAccessControlDefinition>({
        wallets: {
            associate: false
        },
        sequencer: sequencerAccessControl({ roles: m2mApp.roles }),
        rpcMethod: rpcMethodsAccessControl({ roles: m2mApp.roles })
    });
}

export function permixForTenant(tenant: Tenant) {
    return createPermix<UserAccessControlDefinition>({
        wallets: {
            associate: false
        },
        sequencer: sequencerAccessControl({
            roles: tenant.defaultRoles.map((r) => {
                return {
                    id: r.id,
                    roleName: r.roleName,
                    organizationId: r.organizationId ?? null,
                    systemPermissions: r.systemPermissions
                };
            })
        }), // Tenants are not org scoped at the moment.
        rpcMethod: {
            unrestrictedRead: false
        }
    });
}

export function forbiddenPermix() {
    return createPermix<UserAccessControlDefinition>({
        wallets: {
            associate: false
        },
        sequencer: {
            fullAccess: false,
            deployment: false,
            fullReadAccess: false
        },
        rpcMethod: {
            unrestrictedRead: false
        }
    });
}
