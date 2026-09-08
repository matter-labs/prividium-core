import { ROLE_NAME_MAX_LENGTH } from '@repo/access-control';
import { z } from 'zod/v4';
import { rolesTable } from '../../db/schema';
import { createInsertSchema, createSelectSchema, TIMESTAMP_COLUMNS } from '../../utils/drizzle-zod-schema-factory';

export const roleNameField = z.string().min(1).max(ROLE_NAME_MAX_LENGTH);

export const RoleSchema = createSelectSchema(rolesTable);

// join-table projections only guarantee identity and display name
export const BareRoleSchema = createSelectSchema(rolesTable, {
    createdAt: (s) => s.optional(),
    updatedAt: (s) => s.optional(),
    systemPermissions: (s) => s.optional(),
    isSystemRole: (s) => s.optional(),
    organizationId: (s) => s.optional()
});

// role references in request bodies: identified by id alone
export const RoleRefSchema = z.object({
    id: z.string().min(1)
});

export const RoleWithCountsSchema = RoleSchema.extend({
    contractPermissionsCount: z.number().int().nonnegative(),
    usersCount: z.number().int().nonnegative()
});

export const CreateRoleBodySchema = createInsertSchema(rolesTable, {
    roleName: roleNameField
}).omit({ ...TIMESTAMP_COLUMNS, id: true, isSystemRole: true });
