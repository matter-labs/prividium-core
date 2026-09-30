import { hasSystemPermission } from '@repo/access-control';
import { describe, expect, it } from 'vitest';
import { defineFeaturePermission } from './feature-permissions';

describe('defineFeaturePermission', () => {
    it('keeps the declared name, grantability and description', () => {
        expect(
            defineFeaturePermission('example_feature_access', { orgGrantable: true, description: 'Example access' })
        ).toEqual({ name: 'example_feature_access', orgGrantable: true, description: 'Example access' });
    });

    it('omits an absent description', () => {
        expect(defineFeaturePermission('example_feature_access', { orgGrantable: false })).toEqual({
            name: 'example_feature_access',
            orgGrantable: false
        });
    });

    it.each([
        '',
        'Example_access',
        '1example',
        'example-access',
        'example.access',
        '_example',
        'example access'
    ])('rejects %j', (name) => {
        expect(() => defineFeaturePermission(name, { orgGrantable: false })).toThrow(/must match/);
    });

    it('yields a name the core permission checks accept', () => {
        const { name } = defineFeaturePermission('example_feature_access', { orgGrantable: true });
        const holder = { roles: [{ id: 'r', roleName: 'r', organizationId: 'org-1', systemPermissions: [name] }] };

        expect(hasSystemPermission(holder, name, 'org-1')).toBe(true);
        expect(hasSystemPermission(holder, name, 'org-2')).toBe(false);
    });
});
