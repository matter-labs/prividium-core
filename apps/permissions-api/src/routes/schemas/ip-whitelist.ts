import { z } from 'zod/v4';
import { apiKeysIpWhitelistTable } from '../../db/schema';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { paginatedResult } from '../../utils/schemas/pagination';

export const IpWhitelistSchema = createSelectSchema(apiKeysIpWhitelistTable).extend({ isOverbroad: z.boolean() });

export const PaginatedIpWhitelistSchema = paginatedResult(IpWhitelistSchema);

// Allowlisted so a future column cannot widen what org admins receive.
export const OrgIpWhitelistSchema = IpWhitelistSchema.pick({
    id: true,
    ipAddress: true,
    description: true,
    createdAt: true,
    updatedAt: true,
    isOverbroad: true
});

export const PaginatedOrgIpWhitelistSchema = paginatedResult(OrgIpWhitelistSchema);

// owner cols (tenantId/m2mAppId) come from the route, so each route omits its own
export const CreateIpWhitelistBodySchema = createInsertSchema(apiKeysIpWhitelistTable).omit(MANAGED_COLUMNS);
