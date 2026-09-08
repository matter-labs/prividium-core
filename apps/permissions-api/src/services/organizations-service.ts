import type { Repositories } from '../db';

export type OrganizationDeletionResult = {
    revokedSessions: number;
    revokedApiKeys: number;
    releasedWallets: number;
};

/**
 * Soft-deletes an organization, revokes the credentials issued through it, and frees its members'
 * wallet addresses. One-way: restoring the row does not restore them. Takes the caller's
 * `Repositories` so the writes land on the request's own audited connection.
 *
 * With POLICY_DECISION_CACHE_ENABLED, allows already cached for these members stay usable until the
 * entry TTL elapses; the cache is per-replica and TTL-only, with no invalidation seam.
 */
export async function deleteOrganizationAndRevokeAccess(
    repos: Repositories,
    organizationId: string,
    revokedByUserId: string
): Promise<OrganizationDeletionResult> {
    // One transaction: a retry cannot redo a partial failure, since the second delete 404s.
    return repos.transaction(async (tx) => {
        const txRepos = tx.repositories();
        await txRepos.organizations.delete(organizationId);

        return {
            revokedSessions: await txRepos.sessions.revokeAllByOrganizationId(organizationId, revokedByUserId),
            revokedApiKeys: await txRepos.apiKeys.revokeAllOwnedByOrganization(organizationId),
            releasedWallets: await txRepos.users.releaseWalletsByOrganizationId(organizationId)
        };
    });
}
