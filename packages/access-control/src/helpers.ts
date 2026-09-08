import type { Permission, RoleHolder } from './types';

export const ADMIN_ROLE_NAME = 'admin';

// The zone admin role uses a stable, well-known id (equal to its name) rather than a random one, so
// operator config that references it — e.g. SWAGGER_UI_ALLOWED_ROLES — can name a fixed value that is
// identical across environments. Per-organization admin roles are not global and keep generated ids.
export const ADMIN_ROLE_ID = 'admin';

// Default display name of the per-organization admin system role.
export const ORG_ADMIN_ROLE_NAME = 'Admin';

// System role names reserved by the platform: never valid as a custom role name.
export const RESERVED_ROLE_NAMES: ReadonlySet<string> = new Set([ADMIN_ROLE_NAME]);

// If an orgId is provided this returns true only if the system permission is valid for that org.
// That means is present in a role of that organization or in a zone level role (organizationId === null)
export function hasSystemPermission(roleHolder: RoleHolder, permission: Permission, orgId?: string | null): boolean {
    return roleHolder.roles.some((r) => {
        if (orgId !== undefined) {
            const orgMatch = r.organizationId === null || r.organizationId === orgId; // permission is zone level or oranization match
            return r.systemPermissions?.includes(permission) && orgMatch;
        } else {
            return r.systemPermissions?.includes(permission);
        }
    });
}

export function hasAnySystemPermission(
    roleHolder: Pick<RoleHolder, 'roles'>,
    permission: Permission[],
    orgId: string
): boolean {
    return permission.some((p) => hasSystemPermission(roleHolder, p, orgId));
}

// Like hasSystemPermission, but only counts the permission when the holder operates at zone level.
// Use for permissions that grant zone-wide reach (e.g. full_read_access / full_sequencer_rpc_access),
// which must not escalate an org-scoped principal beyond its organization.
export function hasZoneSystemPermission(roleHolder: RoleHolder, permission: Permission): boolean {
    return roleHolder.roles.some((r) => r.systemPermissions?.includes(permission) && r.organizationId === null);
}

// Admin-panel write access is the privilege that requires MFA: such users must complete passkey
// verification at login, and passkey self-service is restricted to them. Keep this aligned with the
// `admin_write` gate on the passkey routes — broadening it would prompt users who cannot register.
export function requiresMfa(roleHolder: RoleHolder): boolean {
    return hasSystemPermission(roleHolder, 'admin_write');
}

// Permissions that grant broad, hard-to-contain access. A role granting any of these is flagged as
// "dangerous" in the admin UI so operators confirm before assigning it.
export const DANGEROUS_PERMISSIONS: readonly Permission[] = ['admin_write', 'full_sequencer_rpc_access'];

export function hasDangerousPermission(permissions: readonly Permission[] | undefined): boolean {
    return permissions?.some((permission) => DANGEROUS_PERMISSIONS.includes(permission)) ?? false;
}
