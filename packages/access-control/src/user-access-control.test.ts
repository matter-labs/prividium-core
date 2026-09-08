import { describe, expect, it } from 'vitest';
import type { RoleHolder, User } from './types';
import {
    rpcMethodsAccessControl,
    sequencerAccessControl,
    userAccessControl,
    userForbiddenAccessControl
} from './user-access-control';

describe('sequencerAccessControl', () => {
    it('grants full sequencer access when the role holds full sequencer and read permissions', () => {
        const roleHolder: RoleHolder = {
            roles: [
                {
                    id: 'role-1',
                    roleName: 'admin',
                    systemPermissions: ['full_sequencer_rpc_access', 'full_read_access'],
                    organizationId: null
                }
            ]
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: true,
            fullReadAccess: true,
            deployment: true
        });
    });

    it('grants permission-specific sequencer capabilities', () => {
        const roleHolder: RoleHolder = {
            roles: [
                { id: 'role-1', roleName: 'deployer', systemPermissions: ['contract_deployment'], organizationId: null }
            ]
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: false,
            fullReadAccess: false,
            deployment: true
        });
    });

    it('grants fullAccess and deployment for full_sequencer_rpc_access permission', () => {
        const roleHolder: RoleHolder = {
            roles: [
                {
                    id: 'role-1',
                    roleName: 'operator',
                    systemPermissions: ['full_sequencer_rpc_access'],
                    organizationId: null
                }
            ]
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: true,
            fullReadAccess: false,
            deployment: true
        });
    });

    it('grants only fullReadAccess for full_read_access permission', () => {
        const roleHolder: RoleHolder = {
            roles: [{ id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: null }]
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: false,
            fullReadAccess: true,
            deployment: false
        });
    });

    it('returns all false when no roles are present', () => {
        const roleHolder: RoleHolder = {
            roles: []
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: false,
            fullReadAccess: false,
            deployment: false
        });
    });

    it('combines permissions from multiple roles', () => {
        const roleHolder: RoleHolder = {
            roles: [
                {
                    id: 'role-1',
                    roleName: 'deployer',
                    systemPermissions: ['contract_deployment'],
                    organizationId: null
                },
                { id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: null }
            ]
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: false,
            fullReadAccess: true,
            deployment: true
        });
    });

    it('denies zone-wide access to an org-scoped holder, but still allows deployment', () => {
        const roleHolder: RoleHolder = {
            roles: [
                {
                    id: 'role-1',
                    roleName: 'org-scoped-role',
                    systemPermissions: ['full_sequencer_rpc_access', 'full_read_access'],
                    organizationId: 'org-1'
                }
            ]
        };

        // full_sequencer_rpc_access / full_read_access grant zone-wide reach, so they must not
        // escalate an org-scoped holder. Deployment is not zone-gated and remains granted.
        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: false,
            fullReadAccess: false,
            deployment: true
        });
    });

    it('denies fullReadAccess to an org-scoped holder with only full_read_access', () => {
        const roleHolder: RoleHolder = {
            roles: [
                { id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: 'org-1' }
            ]
        };

        expect(sequencerAccessControl(roleHolder)).toEqual({
            fullAccess: false,
            fullReadAccess: false,
            deployment: false
        });
    });
});

describe('rpcMethodsAccessControl', () => {
    it('grants unrestrictedRead for a mapped method when the holder is zone-level with the matching permission', () => {
        const roleHolder: RoleHolder = {
            roles: [
                { id: 'role-1', roleName: 'reader', systemPermissions: ['rpc_read_eth_getLogs'], organizationId: null }
            ]
        };

        expect(rpcMethodsAccessControl(roleHolder).unrestrictedRead('eth_getLogs')).toBe(true);
    });

    it('denies unrestrictedRead when the holder has the permission but is org-scoped', () => {
        const roleHolder: RoleHolder = {
            roles: [
                {
                    id: 'role-1',
                    roleName: 'reader',
                    systemPermissions: ['rpc_read_eth_getLogs'],
                    organizationId: 'org-1'
                }
            ]
        };

        expect(rpcMethodsAccessControl(roleHolder).unrestrictedRead('eth_getLogs')).toBe(false);
    });

    it('denies unrestrictedRead for an unmapped method even with broad permissions', () => {
        const roleHolder: RoleHolder = {
            roles: [{ id: 'role-1', roleName: 'admin', systemPermissions: ['full_read_access'], organizationId: null }]
        };

        expect(rpcMethodsAccessControl(roleHolder).unrestrictedRead('eth_getBalance')).toBe(false);
    });

    it('denies unrestrictedRead when the holder lacks the method-specific permission', () => {
        const roleHolder: RoleHolder = {
            roles: [
                { id: 'role-1', roleName: 'reader', systemPermissions: ['rpc_read_eth_getLogs'], organizationId: null }
            ]
        };

        expect(rpcMethodsAccessControl(roleHolder).unrestrictedRead('eth_getTransactionByHash')).toBe(false);
    });
});

describe('userAccessControl', () => {
    it('keeps wallets.associate as a user-only rule', () => {
        const tenantUser: User = {
            source: 'tenant',
            roles: []
        };

        expect(userAccessControl(tenantUser)).toMatchObject({
            wallets: {
                associate: false
            },
            sequencer: {
                fullAccess: false,
                fullReadAccess: false,
                deployment: false
            }
        });
    });

    it('allows wallets.associate for non-tenant users', () => {
        const oidcUser: User = { source: 'oidc', roles: [] };
        const cryptoUser: User = { source: 'crypto_native', roles: [] };
        const adminPanelUser: User = { source: 'adminPanel', roles: [] };

        expect(userAccessControl(oidcUser)).toMatchObject({ wallets: { associate: true } });
        expect(userAccessControl(cryptoUser)).toMatchObject({ wallets: { associate: true } });
        expect(userAccessControl(adminPanelUser)).toMatchObject({ wallets: { associate: true } });
    });

    it('grants full sequencer access for admin users', () => {
        const adminUser: User = {
            source: 'oidc',
            roles: [
                {
                    id: 'role-1',
                    roleName: 'admin',
                    systemPermissions: ['full_sequencer_rpc_access', 'full_read_access'],
                    organizationId: null
                }
            ]
        };

        expect(userAccessControl(adminUser)).toMatchObject({
            wallets: { associate: true },
            sequencer: {
                fullAccess: true,
                fullReadAccess: true,
                deployment: true
            }
        });
    });

    it('confines an org-scoped user holding zone-wide permissions to their organization', () => {
        const orgAdmin: User = {
            source: 'oidc',
            roles: [
                {
                    id: 'role-1',
                    roleName: 'org-scoped-role',
                    systemPermissions: ['full_sequencer_rpc_access', 'full_read_access'],
                    organizationId: 'org-1'
                }
            ]
        };

        expect(userAccessControl(orgAdmin)).toMatchObject({
            sequencer: {
                fullAccess: false,
                fullReadAccess: false,
                deployment: true
            }
        });
    });
});

describe('userForbiddenAccessControl', () => {
    it('denies all permissions', () => {
        expect(userForbiddenAccessControl()).toEqual({
            wallets: { associate: false },
            sequencer: {
                fullAccess: false,
                fullReadAccess: false,
                deployment: false
            },
            rpcMethod: {
                unrestrictedRead: false
            }
        });
    });
});
