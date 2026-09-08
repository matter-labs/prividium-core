import { z } from 'zod/v4';
import { m2mApplicationsTable } from '../../db/schema';
import { nameField } from '../../repositories/shared-schemas';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { paginatedResult } from '../../utils/schemas/pagination';
import { RoleRefSchema, RoleSchema } from './roles';

export const M2mApplicationOrganizationSchema = z.object({
    id: z.string()
});

export const M2mApplicationSchema = createSelectSchema(m2mApplicationsTable).extend({
    roles: RoleSchema.array(),
    organizations: M2mApplicationOrganizationSchema.array(),
    hasOverbroadIpWhitelist: z.boolean()
});

// ownerOrganizationId is never set through the operator body: operator-created credentials
// are zone-level (ownerOrganizationId stays null) and are shared with organizations via `organizationIds`
// (the junction). Org-owned credentials are created on the org-scoped route, which binds ownership
// from the path. Omitting it here keeps the operator surface unchanged after the column was added.
export const CreateM2mApplicationBodySchema = createInsertSchema(m2mApplicationsTable, {
    name: nameField
})
    .omit({ ...MANAGED_COLUMNS, ownerOrganizationId: true })
    .extend({
        roles: RoleRefSchema.array(),
        organizationIds: z.string().array().optional()
    });

export const UpdateM2mApplicationBodySchema = CreateM2mApplicationBodySchema.omit({ organizationIds: true }).required();

export const PaginatedM2mApplicationsSchema = paginatedResult(M2mApplicationSchema);

// Nested role view for org-scoped responses: omit `organizationId` so a peer org can never be
// inferred from a role attached to a shared zone-level credential. For org-owned credentials the
// role's org is always the caller's own; only an operator attaching a peer-org-scoped role to a
// shared zone-level credential would otherwise surface a peer-org id here.
export const OrgM2mRoleSchema = RoleSchema.omit({ organizationId: true });

// Org-scoped read surface: an explicit field allowlist (the data-exposure boundary), NOT a bare
// table select — a future column on m2m_applications must not auto-widen what org admins receive.
// `ownerOrganizationId` is intentionally included so the org view can distinguish org-owned (=== the org)
// from zone-assigned (null) credentials.
export const OrgM2mApplicationSchema = createSelectSchema(m2mApplicationsTable)
    .pick({
        id: true,
        name: true,
        description: true,
        ownerOrganizationId: true,
        createdAt: true,
        updatedAt: true
    })
    .extend({
        roles: OrgM2mRoleSchema.array(),
        hasOverbroadIpWhitelist: z.boolean()
    });

export const PaginatedOrgM2mApplicationsSchema = paginatedResult(OrgM2mApplicationSchema);

// Org-scoped create body: ownership binds from the path :id (not the body), and org admins cannot
// assign the credential to other organizations (organizationIds is dropped). Role attachment is
// validated server-side against the org-admin ceiling.
export const CreateOrgM2mApplicationBodySchema = CreateM2mApplicationBodySchema.omit({ organizationIds: true });

// Org-scoped update body: a full replace (all fields required), mirroring the zone-level PUT
// (`UpdateM2mApplicationBodySchema`) so both update routes share identical semantics.
export const UpdateOrgM2mApplicationBodySchema = CreateOrgM2mApplicationBodySchema.required();
