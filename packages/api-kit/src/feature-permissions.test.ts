import { hasSystemPermission } from '@repo/access-control';
import { describe, expect, it } from 'vitest';
import { defineFeaturePermission } from './feature-permissions';

describe('defineFeaturePermission', () => {
    it('keeps the declared name, owning feature and grantability', () => {
        expect(
            defineFeaturePermission('example_feature_access', { feature: 'example-feature', orgGrantable: true })
        ).toEqual({
            name: 'example_feature_access',
            feature: 'example-feature',
            orgGrantable: true
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
        expect(() => defineFeaturePermission(name, { feature: 'example-feature', orgGrantable: false })).toThrow(
            /must match/
        );
    });

    it('yields a name the core permission checks accept', () => {
        const { name } = defineFeaturePermission('example_feature_access', {
            feature: 'example-feature',
            orgGrantable: true
        });
        const holder = { roles: [{ id: 'r', roleName: 'r', organizationId: 'org-1', systemPermissions: [name] }] };

        expect(hasSystemPermission(holder, name, 'org-1')).toBe(true);
        expect(hasSystemPermission(holder, name, 'org-2')).toBe(false);
    });
});
