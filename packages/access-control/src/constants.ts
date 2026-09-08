import type { Permission } from './types';

/**
 * Maximum length for user-facing name and displayName fields (e.g. application,
 * organization, tenant, service, M2M app, user display name). Enforced
 * at both the form layer (admin UI) and the API repository Zod schemas.
 */
export const NAME_MAX_LENGTH = 100;

/**
 * Maximum length for role names. Shorter than NAME_MAX_LENGTH because role
 * names are used as inline identifiers throughout the UI.
 */
export const ROLE_NAME_MAX_LENGTH = 50;

/**
 * System permissions an organization admin is allowed to grant on its custom roles. Everything else
 * is zone-wide and not an org admin's to delegate. Enforced server-side (the org roles repository
 * rejects anything outside this set) and mirrored in the admin UI to restrict the org role picker.
 * Only permissions already confined to a single org belong here — re-add others (scoped) once RPC
 * enforcement is org-scoped.
 */
export const ORG_ADMIN_GRANTABLE_PERMISSIONS = [
    'org_users_manage',
    'org_wallets_manage',
    'org_rpc_access',
    'org_policy_access'
] as const satisfies readonly Permission[];
