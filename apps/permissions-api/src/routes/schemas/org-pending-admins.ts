import { orgPendingAdminsTable } from '../../db/schema';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';

export const OrgPendingAdminSchema = createSelectSchema(orgPendingAdminsTable);

// organizationId comes from the route param
export const CreateOrgPendingAdminBodySchema = createInsertSchema(orgPendingAdminsTable, {
    oidcSub: (v) => v.min(1)
}).omit({ ...MANAGED_COLUMNS, organizationId: true });
