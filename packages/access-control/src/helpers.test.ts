import { describe, expect, it } from 'vitest';
import {
    hasAnySystemPermission,
    hasDangerousPermission,
    hasSystemPermission,
    hasZoneSystemPermission,
    requiresMfa
} from './helpers';
import type { RoleHolder, User } from './types';

describe('hasSystemPermission', () => {
    it('returns true when user has role containing the permission', () => {
        const user: User = {
            source: 'oidc',
            roles: [{ id: 'role-1', roleName: 'auditor', systemPermissions: ['admin_read'], organizationId: null }]
        };
        expect(hasSystemPermission(user, 'admin_read')).toBe(true);
    });

    it('returns false when user has role with other permissions but not the required one', () => {
        const user: User = {
            source: 'oidc',
            roles: [
                { id: 'role-1', roleName: 'deployer', systemPermissions: ['contract_deployment'], organizationId: null }
            ]
        };
        expect(hasSystemPermission(user, 'admin_read')).toBe(false);
    });

    it('returns true when user has multiple roles and one contains the permission', () => {
        const user: User = {
            source: 'oidc',
            roles: [
                {
                    id: 'role-1',
                    roleName: 'deployer',
                    systemPermissions: ['contract_deployment'],
                    organizationId: null
                },
                { id: 'role-1', roleName: 'auditor', systemPermissions: ['admin_read'], organizationId: null }
            ]
        };
        expect(hasSystemPermission(user, 'admin_read')).toBe(true);
    });

    it('returns false when user has empty roles', () => {
        const user: User = {
            source: 'oidc',
            roles: []
        };
        expect(hasSystemPermission(user, 'admin_read')).toBe(false);
    });

    describe('with an orgId', () => {
        it('returns true when the permission is held in a role scoped to that org', () => {
            const user: User = {
                source: 'oidc',
                roles: [
                    {
                        id: 'role-1',
                        roleName: 'org-reader',
                        systemPermissions: ['full_read_access'],
                        organizationId: 'org1'
                    }
                ]
            };
            expect(hasSystemPermission(user, 'full_read_access', 'org1')).toBe(true);
        });

        it('returns false when the permission is held only in a role scoped to a different org', () => {
            const user: User = {
                source: 'oidc',
                roles: [
                    {
                        id: 'role-1',
                        roleName: 'org-reader',
                        systemPermissions: ['full_read_access'],
                        organizationId: 'org1'
                    }
                ]
            };
            expect(hasSystemPermission(user, 'full_read_access', 'org2')).toBe(false);
        });

        it('returns true when the permission is held in a zone-level role, for any org', () => {
            const user: User = {
                source: 'oidc',
                roles: [
                    { id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: null }
                ]
            };
            expect(hasSystemPermission(user, 'full_read_access', 'org1')).toBe(true);
        });
    });
});

describe('hasAnySystemPermission', () => {
    const user: User = {
        source: 'oidc',
        roles: [{ id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: 'org1' }]
    };

    it('returns true when the holder has at least one of the listed permissions', () => {
        expect(hasAnySystemPermission(user, ['full_sequencer_rpc_access', 'full_read_access'], 'org1')).toBe(true);
    });

    it('returns false when the holder has at least one of the listed permissions but for a different org', () => {
        expect(hasAnySystemPermission(user, ['full_sequencer_rpc_access', 'full_read_access'], 'org2')).toBe(false);
    });

    it('returns false when the holder has none of the listed permissions', () => {
        expect(hasAnySystemPermission(user, ['full_sequencer_rpc_access', 'admin_write'], 'org1')).toBe(false);
    });

    it('returns false for an empty permission list', () => {
        expect(hasAnySystemPermission(user, [], 'org1')).toBe(false);
    });
});

describe('hasZoneSystemPermission', () => {
    it('returns true when the holder is zone-level and has the permission', () => {
        const roleHolder: RoleHolder = {
            roles: [{ id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: null }]
        };
        expect(hasZoneSystemPermission(roleHolder, 'full_read_access')).toBe(true);
    });

    it('returns false when the holder has the permission but is org-scoped', () => {
        const roleHolder: RoleHolder = {
            roles: [
                { id: 'role-1', roleName: 'reader', systemPermissions: ['full_read_access'], organizationId: 'org-1' }
            ]
        };
        expect(hasZoneSystemPermission(roleHolder, 'full_read_access')).toBe(false);
    });

    it('returns false when the holder is zone-level but lacks the permission', () => {
        const roleHolder: RoleHolder = {
            roles: [
                { id: 'role-1', roleName: 'deployer', systemPermissions: ['contract_deployment'], organizationId: null }
            ]
        };
        expect(hasZoneSystemPermission(roleHolder, 'full_read_access')).toBe(false);
    });
});

describe('requiresMfa', () => {
    it('returns true when a role grants admin_write', () => {
        const user: User = {
            source: 'oidc',
            roles: [{ id: 'role-1', roleName: 'admin', systemPermissions: ['admin_write'], organizationId: null }]
        };
        expect(requiresMfa(user)).toBe(true);
    });

    it('returns false for full_sequencer_rpc_access without admin_write', () => {
        const user: User = {
            source: 'oidc',
            roles: [
                {
                    id: 'role-1',
                    roleName: 'operator',
                    systemPermissions: ['full_sequencer_rpc_access'],
                    organizationId: null
                }
            ]
        };
        expect(requiresMfa(user)).toBe(false);
    });

    it('returns false when the user only holds low-privilege permissions', () => {
        const user: User = {
            source: 'oidc',
            roles: [{ id: 'role-1', roleName: 'auditor', systemPermissions: ['admin_read'], organizationId: null }]
        };
        expect(requiresMfa(user)).toBe(false);
    });
});

describe('hasDangerousPermission', () => {
    it('returns true when the set includes admin_write', () => {
        expect(hasDangerousPermission(['admin_read', 'admin_write'])).toBe(true);
    });

    it('returns true when the set includes full_sequencer_rpc_access', () => {
        expect(hasDangerousPermission(['full_sequencer_rpc_access'])).toBe(true);
    });

    it('returns false for a low-privilege set', () => {
        expect(hasDangerousPermission(['admin_read', 'contract_deployment'])).toBe(false);
    });

    it('returns false for undefined or empty permissions', () => {
        expect(hasDangerousPermission(undefined)).toBe(false);
        expect(hasDangerousPermission([])).toBe(false);
    });
});
