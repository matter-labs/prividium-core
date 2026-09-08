import { z } from 'zod/v4';
import { tenantsTable } from '../../db/schema';
import { nameField } from '../../repositories/shared-schemas';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { hexSchema } from '../../utils/schemas/hex-schema';
import { paginatedResult } from '../../utils/schemas/pagination';
import { BareRoleSchema, RoleRefSchema } from './roles';

export const WalletAddressSchema = z.object({ walletAddress: hexSchema });

export const TenantSchema = createSelectSchema(tenantsTable, {
    publicKey: hexSchema
}).extend({
    defaultRoles: BareRoleSchema.array()
});

export const CreateTenantBodySchema = createInsertSchema(tenantsTable, {
    name: nameField,
    publicKey: hexSchema
})
    .omit(MANAGED_COLUMNS)
    .extend({ defaultRoles: RoleRefSchema.array() });

export const TenantUserSchema = z.object({
    id: z.string(),
    walletAddresses: WalletAddressSchema.array(),
    displayName: z.string()
});

export const CreateTenantUserBodySchema = TenantUserSchema.omit({ id: true });

export const PaginatedTenantsSchema = paginatedResult(TenantSchema);
export const PaginatedTenantUsersSchema = paginatedResult(TenantUserSchema);
