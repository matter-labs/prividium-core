// `organization` is required so a partial user select cannot reach this check without the marker;
// the null branch below still fails closed if the relation is absent at runtime.
type OrganizationMember = {
    organizationId: string | null;
    organization: { deletedAt: Date | null } | null;
};

/**
 * Whether a principal's organization membership has stopped granting access. An organization's rows
 * outlive its soft delete, so membership alone proves nothing.
 *
 * A member whose organization was not loaded counts as deleted: the FK guarantees the row exists, so
 * an absent relation means the caller cannot prove liveness, and access is denied rather than assumed.
 */
export function belongsToDeletedOrganization(principal: OrganizationMember): boolean {
    if (principal.organizationId === null) {
        return false;
    }
    return principal.organization == null || principal.organization.deletedAt !== null;
}
