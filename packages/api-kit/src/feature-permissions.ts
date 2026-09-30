import type { FeaturePermissionName } from '@repo/access-control';

/** What `defineFeaturePermission` and the core accept as a feature permission name. */
export const FEATURE_PERMISSION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A permission a feature owns and declares to the core, so roles may hold it. */
export type FeaturePermission = {
    readonly name: FeaturePermissionName;
    /** Whether an organization admin may grant it on the organization's own roles. */
    readonly orgGrantable: boolean;
    /** Help text an admin panel shows beside the name. */
    readonly description?: string;
};

/**
 * Declares a permission a feature owns; list it in the composition root's `featurePermissions`.
 * @throws Error when `name` is not lowercase snake_case.
 */
export function defineFeaturePermission(
    name: string,
    opts: { orgGrantable: boolean; description?: string }
): FeaturePermission {
    if (!FEATURE_PERMISSION_NAME_PATTERN.test(name)) {
        throw new Error(`Feature permission "${name}" must match ${FEATURE_PERMISSION_NAME_PATTERN}`);
    }
    return {
        name: name as FeaturePermissionName,
        orgGrantable: opts.orgGrantable,
        ...(opts.description === undefined ? {} : { description: opts.description })
    };
}
