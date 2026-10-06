import { defineFeaturePermission } from '@repo/api-kit';
import { describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { PermissionCatalog } from '../permissions/permission-catalog';
import { RepositoriesCoreFacts } from './repositories-core-facts';

const EXAMPLE_ACCESS = defineFeaturePermission('example_feature_access', {
    feature: 'example-feature',
    orgGrantable: true
});
const withExampleFeature = new PermissionCatalog([EXAMPLE_ACCESS]);

describe('RepositoriesCoreFacts with a feature permission', () => {
    it('finds the roles holding it in an organization and at zone level', async ({ db }) => {
        const repos = new Repositories(db);
        const org = await repos.organizations.create({ name: 'Org', defaultRoles: [] });
        const orgRole = await repos.roles.create(
            { roleName: 'org-feature', systemPermissions: [EXAMPLE_ACCESS.name] },
            { organizationId: org.id, catalog: withExampleFeature }
        );
        const zoneRole = await repos.roles.create(
            { roleName: 'zone-feature', systemPermissions: [EXAMPLE_ACCESS.name] },
            { catalog: withExampleFeature }
        );
        await repos.roles.create({ roleName: 'unrelated', systemPermissions: ['admin_read'] });
        const facts = new RepositoriesCoreFacts({ repos, multiOrgEnabled: true });

        expect((await facts.rolesWithPermission(org.id, EXAMPLE_ACCESS.name)).sort()).toEqual(
            [orgRole.id, zoneRole.id].sort()
        );
        expect(await facts.zoneRolesWithPermission(EXAMPLE_ACCESS.name)).toEqual([zoneRole.id]);
    });
});
