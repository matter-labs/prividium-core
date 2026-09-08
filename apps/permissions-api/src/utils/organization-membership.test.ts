import { describe, expect, it } from 'vitest';
import { belongsToDeletedOrganization } from './organization-membership';

describe('belongsToDeletedOrganization', () => {
    it('is false for a zone principal', () => {
        expect(belongsToDeletedOrganization({ organizationId: null, organization: null })).toBe(false);
    });

    it('is false for a member of a live organization', () => {
        expect(belongsToDeletedOrganization({ organizationId: 'org-1', organization: { deletedAt: null } })).toBe(
            false
        );
    });

    it('is true for a member of a soft-deleted organization', () => {
        expect(belongsToDeletedOrganization({ organizationId: 'org-1', organization: { deletedAt: new Date() } })).toBe(
            true
        );
    });

    // Fails closed: the FK guarantees the row exists, so an absent relation means liveness is unproven.
    it('is true when the membership cannot be verified', () => {
        expect(belongsToDeletedOrganization({ organizationId: 'org-1', organization: null })).toBe(true);
    });
});
