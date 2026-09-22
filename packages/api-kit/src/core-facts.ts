import type { Permission } from '@repo/access-control';
import type { AbiFunction, Address } from 'viem';
import type { MethodSelector } from './schemas/hex-schema';

/**
 * The projection of core data a private feature may read, implemented only by the
 * core. Reads only, so the implementation can move behind HTTP later.
 */

export type SigningIdentity = {
    id: string;
    organizationId: string | null;
    roleIds: readonly string[];
};

/** Core vocabulary: a feature's identical union assigns from it without importing. */
export type AddressClass = 'contract' | 'wallet' | 'unknown';

/** So a feature can reject a cross-organization reference without querying core tables. */
export type CoreReferences = {
    roleIds: ReadonlySet<string>;
    userIds: ReadonlySet<string>;
    m2mAppIds: ReadonlySet<string>;
    contractAddresses: readonly Address[];
    /** Holders per role, for a feature that has to reject an unreachable quorum. */
    roleMemberCounts: ReadonlyMap<string, number>;
};

/**
 * Facts a feature reads about the core. Where a method takes an organization, `null` is the
 * zone itself -- the only scope a deployment with organizations switched off has.
 */
export interface CoreFacts {
    identityForAddress(address: Address): Promise<SigningIdentity | undefined>;

    classifyAddress(organizationId: string | null, address: Address): Promise<AddressClass>;

    /**
     * The one function the selector names, not the contract's whole ABI: the caller
     * decodes arguments with it. Falls back to the contract's template ABI. Returns
     * rather than throws — the caller owns the error wording, and an unregistered
     * destination is not a failure.
     */
    abiFor(contractAddress: Address, selector: MethodSelector): Promise<AbiFunction | undefined>;

    referencesFor(organizationId: string | null): Promise<CoreReferences>;

    holdersByRole(roleIds: readonly string[]): Promise<Map<string, string[]>>;

    userHoldersOfRoles(roleIds: readonly string[]): Promise<string[]>;

    rolesWithPermission(organizationId: string | null, permission: Permission): Promise<string[]>;

    /** Zone-scoped roles only: their holders act across every organization. */
    zoneRolesWithPermission(permission: Permission): Promise<string[]>;

    /** Read-only, unlike the core's get-or-create: `undefined` where that would create. */
    findOrgAdminRole(organizationId: string | null): Promise<{ id: string } | undefined>;
}
