import {
    defineFeaturePermission,
    type FeaturePermission,
    type FeaturePermissionName,
    InvalidInputError
} from '@repo/api-kit';
import { describe, expect, it } from 'vitest';
import { CORE_PERMISSION_CATALOG, PermissionCatalog } from './permission-catalog';
import { ALL_SYSTEM_PERMISSIONS } from './system-permissions';

const EXAMPLE_ACCESS = defineFeaturePermission('example_feature_access', {
    orgGrantable: true,
    description: 'Example feature access'
});
const EXAMPLE_OPERATE = defineFeaturePermission('example_feature_operate', { orgGrantable: false });

const forged = (name: string): FeaturePermission => ({ name: name as FeaturePermissionName, orgGrantable: false });

describe('PermissionCatalog', () => {
    describe('construction', () => {
        it('holds the core names alone when no feature declares any', () => {
            expect(CORE_PERMISSION_CATALOG.names).toEqual(ALL_SYSTEM_PERMISSIONS);
            expect(CORE_PERMISSION_CATALOG.featurePermissions).toEqual([]);
        });

        it('adds the declared feature names after the core ones', () => {
            const catalog = new PermissionCatalog([EXAMPLE_ACCESS, EXAMPLE_OPERATE]);

            expect(catalog.names).toEqual([...ALL_SYSTEM_PERMISSIONS, EXAMPLE_ACCESS.name, EXAMPLE_OPERATE.name]);
            expect(catalog.featurePermissions).toEqual([EXAMPLE_ACCESS, EXAMPLE_OPERATE]);
        });

        it('rejects a malformed name that bypassed defineFeaturePermission', () => {
            expect(() => new PermissionCatalog([forged('Example-Access')])).toThrow(/must match/);
        });

        it('rejects a name the core already owns', () => {
            expect(() => new PermissionCatalog([forged('admin_write')])).toThrow(/collides with a core permission/);
        });

        it('rejects a name declared twice', () => {
            expect(() => new PermissionCatalog([EXAMPLE_ACCESS, { ...EXAMPLE_ACCESS, orgGrantable: false }])).toThrow(
                /declared twice/
            );
        });
    });

    describe('unknownOf', () => {
        it('accepts core names and registered feature names', () => {
            const catalog = new PermissionCatalog([EXAMPLE_ACCESS]);

            expect(catalog.unknownOf(['admin_read', EXAMPLE_ACCESS.name])).toEqual([]);
        });

        it('returns a feature name this deployment does not register', () => {
            expect(CORE_PERMISSION_CATALOG.unknownOf(['admin_read', EXAMPLE_ACCESS.name])).toEqual([
                EXAMPLE_ACCESS.name
            ]);
        });
    });

    describe('assertKnown', () => {
        it('names each unknown entry once', () => {
            expect(() =>
                CORE_PERMISSION_CATALOG.assertKnown(['admin_read', EXAMPLE_ACCESS.name, EXAMPLE_ACCESS.name])
            ).toThrow(new InvalidInputError('Unknown system permissions: example_feature_access'));
        });

        it('passes a list the catalog knows', () => {
            expect(() => new PermissionCatalog([EXAMPLE_ACCESS]).assertKnown([EXAMPLE_ACCESS.name])).not.toThrow();
        });
    });

    describe('outsideOrgCeiling', () => {
        const catalog = new PermissionCatalog([EXAMPLE_ACCESS, EXAMPLE_OPERATE]);

        it('allows org-grantable core permissions', () => {
            expect(catalog.outsideOrgCeiling(['org_users_manage', 'org_rpc_access', 'org_wallets_manage'])).toEqual([]);
            expect(catalog.outsideOrgCeiling([])).toEqual([]);
        });

        it('rejects operator/zone-only permissions and the org-admin marker', () => {
            expect(catalog.outsideOrgCeiling(['admin_read'])).toEqual(['admin_read']);
            expect(catalog.outsideOrgCeiling(['admin_write'])).toEqual(['admin_write']);
            expect(catalog.outsideOrgCeiling(['full_sequencer_rpc_access'])).toEqual(['full_sequencer_rpc_access']);
        });

        it('rejects permissions that are not org-scoped yet', () => {
            expect(catalog.outsideOrgCeiling(['full_read_access'])).toEqual(['full_read_access']);
            expect(catalog.outsideOrgCeiling(['rpc_read_eth_getLogs'])).toEqual(['rpc_read_eth_getLogs']);
            expect(catalog.outsideOrgCeiling(['contract_metadata_read'])).toEqual(['contract_metadata_read']);
            expect(catalog.outsideOrgCeiling(['check_user_read_access'])).toEqual(['check_user_read_access']);
            expect(catalog.outsideOrgCeiling(['contract_deployment'])).toEqual(['contract_deployment']);
        });

        it('returns only the disallowed entries from a mixed list', () => {
            expect(catalog.outsideOrgCeiling(['org_rpc_access', 'admin_write', 'full_read_access'])).toEqual([
                'admin_write',
                'full_read_access'
            ]);
        });

        it('follows what each feature declared as org-grantable', () => {
            expect(catalog.outsideOrgCeiling([EXAMPLE_ACCESS.name, EXAMPLE_OPERATE.name])).toEqual([
                EXAMPLE_OPERATE.name
            ]);
        });

        it('treats a name no registered feature declares as not grantable', () => {
            expect(CORE_PERMISSION_CATALOG.outsideOrgCeiling([EXAMPLE_ACCESS.name])).toEqual([EXAMPLE_ACCESS.name]);
        });
    });
});
