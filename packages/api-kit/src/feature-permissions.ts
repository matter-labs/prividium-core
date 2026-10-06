import type { FeaturePermissionName } from '@repo/access-control';

/** What `defineFeaturePermission` and the core accept as a feature permission name. */
export const FEATURE_PERMISSION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A permission a feature owns and declares to the core, so roles may hold it. */
export type FeaturePermission = {
    readonly name: FeaturePermissionName;
    /** The owning feature's name, as it registers in `featureNames`. */
    readonly feature: string;
    /** Whether an organization admin may grant it on the organization's own roles. */
    readonly orgGrantable: boolean;
};

/**
 * Declares a permission a feature owns; list it in the composition root's `featurePermissions`.
 * @throws Error when `name` is not lowercase snake_case.
 */
export function defineFeaturePermission(
    name: string,
    opts: { feature: string; orgGrantable: boolean }
): FeaturePermission {
    if (!FEATURE_PERMISSION_NAME_PATTERN.test(name)) {
        throw new Error(`Feature permission "${name}" must match ${FEATURE_PERMISSION_NAME_PATTERN}`);
    }
    return { name: name as FeaturePermissionName, feature: opts.feature, orgGrantable: opts.orgGrantable };
}
