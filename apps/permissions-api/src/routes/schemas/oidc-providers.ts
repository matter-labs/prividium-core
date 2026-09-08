import { z } from 'zod/v4';
import { oidcProvidersTable } from '../../db/schema';
import { createInsertSchema, createSelectSchema, TIMESTAMP_COLUMNS } from '../../utils/drizzle-zod-schema-factory';

export const OidcProviderSchema = createSelectSchema(oidcProvidersTable);

// organizationId comes from the route param
export const SetOidcProviderBodySchema = createInsertSchema(oidcProvidersTable)
    .omit({
        ...TIMESTAMP_COLUMNS,
        organizationId: true
    })
    .extend({
        userPanelUrl: z.string().min(1)
    });
