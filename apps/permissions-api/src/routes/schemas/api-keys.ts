import { z } from 'zod/v4';
import { apiKeysTable } from '../../db/schema';
import { createInsertSchema, createSelectSchema } from '../../utils/drizzle-zod-schema-factory';
import { paginatedResult } from '../../utils/schemas/pagination';

const SECONDS_PER_DAY = 24 * 60 * 60;

export const ApiKeySchema = createSelectSchema(apiKeysTable).omit({ keyHash: true });

// plaintext key is returned once, at creation
export const ApiKeyWithSecretSchema = ApiKeySchema.extend({
    fullKey: z.string()
});

export const PaginatedApiKeysSchema = paginatedResult(ApiKeySchema);

// Allowlisted so a future column cannot widen what org admins receive.
export const OrgApiKeySchema = ApiKeySchema.pick({
    id: true,
    name: true,
    keyPrefix: true,
    expiresAt: true,
    lastUsedAt: true,
    lastUsedIp: true,
    revokedAt: true,
    createdAt: true,
    updatedAt: true
});

export const OrgApiKeyWithSecretSchema = OrgApiKeySchema.extend({
    fullKey: z.string()
});

export const PaginatedOrgApiKeysSchema = paginatedResult(OrgApiKeySchema);

// a function because the max-expiration cap is per-route
export function createApiKeyBodySchema(maxExpirationSeconds: number) {
    const maxDays = Math.floor(maxExpirationSeconds / SECONDS_PER_DAY);
    return createInsertSchema(apiKeysTable, {
        name: (v) => v.min(1).max(100),
        expiresAt: (v) =>
            v.refine(
                (date) => date.getTime() <= Date.now() + maxExpirationSeconds * 1000,
                `Expiration cannot exceed ${maxDays} days`
            )
    }).pick({ name: true, expiresAt: true });
}
