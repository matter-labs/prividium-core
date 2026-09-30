import { FEATURE_PERMISSION_NAME_PATTERN, type FeaturePermission, InvalidInputError } from '@repo/api-kit';
import { ALL_SYSTEM_PERMISSIONS, ORG_ADMIN_GRANTABLE_PERMISSIONS } from './system-permissions';

/** The system permissions this deployment accepts on a role: the core's own plus every registered feature's. */
export class PermissionCatalog {
    /** Core names, then each feature's; the zone admin role is granted all of them. */
    readonly names: readonly string[];
    private readonly known: ReadonlySet<string>;
    private readonly orgGrantable: ReadonlySet<string>;

    /** @throws Error on a malformed name, a core name, or a name two features declare. */
    constructor(readonly featurePermissions: readonly FeaturePermission[] = []) {
        const core = new Set<string>(ALL_SYSTEM_PERMISSIONS);
        const known = new Set<string>(core);
        const orgGrantable = new Set<string>(ORG_ADMIN_GRANTABLE_PERMISSIONS);
        for (const permission of featurePermissions) {
            // Re-checked: the brand is a type, and a cast forges it.
            if (!FEATURE_PERMISSION_NAME_PATTERN.test(permission.name)) {
                throw new Error(
                    `Feature permission "${permission.name}" must match ${FEATURE_PERMISSION_NAME_PATTERN}`
                );
            }
            if (core.has(permission.name)) {
                throw new Error(`Feature permission "${permission.name}" collides with a core permission`);
            }
            if (known.has(permission.name)) {
                throw new Error(`Feature permission "${permission.name}" is declared twice`);
            }
            known.add(permission.name);
            if (permission.orgGrantable) {
                orgGrantable.add(permission.name);
            }
        }
        this.names = [...known];
        this.known = known;
        this.orgGrantable = orgGrantable;
    }

    /** The entries neither the core nor a registered feature declares. */
    unknownOf(permissions: readonly string[]): string[] {
        return permissions.filter((permission) => !this.known.has(permission));
    }

    /** @throws InvalidInputError naming every entry {@link unknownOf} returns. */
    assertKnown(permissions: readonly string[]): void {
        const unknown = [...new Set(this.unknownOf(permissions))];
        if (unknown.length > 0) {
            throw new InvalidInputError(`Unknown system permissions: ${unknown.join(', ')}`);
        }
    }

    /** The entries an organization admin may not grant. An unknown name is never grantable. */
    outsideOrgCeiling(permissions: readonly string[]): string[] {
        return permissions.filter((permission) => !this.orgGrantable.has(permission));
    }
}

/** A deployment without features: the fail-closed default for any role write or assignment given no catalog. */
export const CORE_PERMISSION_CATALOG = new PermissionCatalog();

/** Skips the catalog check. Only for provisioning, so a stale default role never blocks a user. */
export const UNCHECKED_PERMISSIONS = 'unchecked';

/** A catalog to check assigned roles against, or an explicit skip. */
export type PermissionCheck = PermissionCatalog | typeof UNCHECKED_PERMISSIONS;
