import { describe, expect, it } from 'vitest';
import { permissionsOutsideOrgCeiling } from './system-permissions';

describe('permissionsOutsideOrgCeiling', () => {
    it('allows org-grantable permissions', () => {
        expect(permissionsOutsideOrgCeiling(['org_users_manage', 'org_rpc_access', 'org_wallets_manage'])).toEqual([]);
        expect(permissionsOutsideOrgCeiling([])).toEqual([]);
    });

    it('rejects operator/zone-only permissions and the org-admin marker', () => {
        expect(permissionsOutsideOrgCeiling(['admin_read'])).toEqual(['admin_read']);
        expect(permissionsOutsideOrgCeiling(['admin_write'])).toEqual(['admin_write']);
        expect(permissionsOutsideOrgCeiling(['full_sequencer_rpc_access'])).toEqual(['full_sequencer_rpc_access']);
    });

    it('rejects permissions that are not org-scoped yet', () => {
        expect(permissionsOutsideOrgCeiling(['full_read_access'])).toEqual(['full_read_access']);
        expect(permissionsOutsideOrgCeiling(['rpc_read_eth_getLogs'])).toEqual(['rpc_read_eth_getLogs']);
        expect(permissionsOutsideOrgCeiling(['contract_metadata_read'])).toEqual(['contract_metadata_read']);
        expect(permissionsOutsideOrgCeiling(['check_user_read_access'])).toEqual(['check_user_read_access']);
        expect(permissionsOutsideOrgCeiling(['contract_deployment'])).toEqual(['contract_deployment']);
    });

    it('returns only the disallowed entries from a mixed list', () => {
        expect(permissionsOutsideOrgCeiling(['org_rpc_access', 'admin_write', 'full_read_access'])).toEqual([
            'admin_write',
            'full_read_access'
        ]);
    });
});
