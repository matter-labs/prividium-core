import { ADMIN_ROLE_ID, ADMIN_ROLE_NAME } from '@repo/access-control';
import { describe, expect, it } from 'vitest';
import type { UserWithRoles } from '../repositories/users-repository';
import { resolveContractOwnerOrganizationId } from './contracts-routes';

function caller(organizationId: string | null, roleNames: string[]): UserWithRoles {
    return {
        id: 'u',
        displayName: 'u',
        oidcSub: null,
        oidcIssuer: null,
        walletToken: null,
        source: 'adminPanel',
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: null,
        wallets: [],
        roles: roleNames.map((roleName) => ({
            // The zone admin role carries the stable id used for operator checks.
            id: roleName === ADMIN_ROLE_NAME ? ADMIN_ROLE_ID : `role-${roleName}`,
            roleName,
            systemPermissions: [],
            isSystemRole: false,
            organizationId: null,
            createdAt: new Date(),
            updatedAt: new Date()
        }))
    };
}

const operator = caller(null, [ADMIN_ROLE_NAME]);
const orgMember = caller('org-a', ['Admin(org-a)']);
const orglessUser = caller(null, ['some_role']);

describe('resolveContractOwnerOrganizationId', () => {
    describe('operator (zone admin)', () => {
        it('defaults to their own org (zone) when not provided', () => {
            expect(resolveContractOwnerOrganizationId(operator, undefined)).toBeNull();
        });
        it('may target any organization', () => {
            expect(resolveContractOwnerOrganizationId(operator, 'org-b')).toBe('org-b');
        });
        it('may request a zone-level contract with explicit null', () => {
            expect(resolveContractOwnerOrganizationId(operator, null)).toBeNull();
        });
    });

    describe('organization member', () => {
        it('defaults to their own org when not provided', () => {
            expect(resolveContractOwnerOrganizationId(orgMember, undefined)).toBe('org-a');
        });
        it('may set their own org explicitly', () => {
            expect(resolveContractOwnerOrganizationId(orgMember, 'org-a')).toBe('org-a');
        });
        it('cannot assign to another org', () => {
            expect(() => resolveContractOwnerOrganizationId(orgMember, 'org-b')).toThrow();
        });
        it('cannot request a zone-level contract', () => {
            expect(() => resolveContractOwnerOrganizationId(orgMember, null)).toThrow();
        });
    });

    it('rejects a non-operator without an organization', () => {
        expect(() => resolveContractOwnerOrganizationId(orglessUser, undefined)).toThrow();
        expect(() => resolveContractOwnerOrganizationId(orglessUser, 'org-a')).toThrow();
    });
});
