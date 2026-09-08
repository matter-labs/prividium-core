import { z } from 'zod/v4';
import { organizationsTable } from '../../db/schema';
import { nameField } from '../../repositories/shared-schemas';
import { isValidHexColor, sanitizeLogoUrl } from '../../utils/branding';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { isSiweCompatibleDomain } from '../../utils/siwe-domain';
import { BareRoleSchema, RoleRefSchema } from './roles';

export const OrganizationSchema = createSelectSchema(organizationsTable).extend({
    defaultRoles: BareRoleSchema.array()
});

export const OrganizationSummarySchema = OrganizationSchema.pick({ id: true, name: true });

// Branding is managed only through the dedicated all-or-nothing PATCH /:id branding endpoint
// (UpdateBrandingBodySchema), so it is omitted from create / general-update to keep it from being set
// piecemeal — a partial set would render a mixed identity (org name beside the zone logo). SIWE
// settings likewise have their own zone-admin PUT /:id/siwe-settings endpoint.
const brandingFields = { brandName: true, logoUrl: true, primaryColor: true } as const;
const siweSettingsFields = { siweLoginEnabled: true, siweAllowedDomains: true } as const;

export const CreateOrganizationBodySchema = createInsertSchema(organizationsTable, {
    name: nameField
})
    .omit({ ...MANAGED_COLUMNS, deletedAt: true, ...brandingFields, ...siweSettingsFields })
    .extend({
        defaultRoles: RoleRefSchema.array()
    });

export const UpdateOrganizationBodySchema = CreateOrganizationBodySchema;

// Branding moves as a complete unit: all three set, or all three null to drop back to the zone brand.
// Partial branding would render a mixed identity. `name` is the org name, not branding, so it stays optional.
export const UpdateBrandingBodySchema = z
    .object({
        name: nameField.optional(),
        // brandName is embedded in SIWE challenge statements, and EIP-4361 statements reject line breaks
        // (viem throws at challenge creation) — so they are blocked here at write time.
        brandName: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^\r\n]+$/, 'brandName must not contain line breaks')
            .nullable(),
        logoUrl: z
            .string()
            .min(1)
            .max(2048)
            .transform(sanitizeLogoUrl)
            .refine((value) => value !== '', 'logoUrl must be an https:// URL or a path on the panel origin')
            .nullable(),
        primaryColor: z
            .string()
            .min(1)
            .refine(isValidHexColor, 'primaryColor must be a #RGB or #RRGGBB hex value')
            .nullable()
    })
    .refine(
        ({ brandName, logoUrl, primaryColor }) => {
            const fields = [brandName, logoUrl, primaryColor];
            return fields.every((field) => field === null) || fields.every((field) => field !== null);
        },
        { message: 'branding fields must be set together or cleared together' }
    );

// A bare host exactly as browsers send it in window.location.host — lowercase hostname with optional
// port; no scheme, path, or whitespace. Lowercase is enforced because challenge requests compare the
// browser-lowercased host against these entries verbatim.
const siweDomainField = z
    .string()
    .min(1)
    .max(255)
    .regex(
        /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/,
        'must be a lowercase bare host, e.g. "app.example.com" or "localhost:3000"'
    )
    .refine(isSiweCompatibleDomain, 'must be a SIWE-compatible domain (dotted hostname, IPv4 address, or localhost)');

export const UpdateSiweSettingsBodySchema = z.object({
    siweLoginEnabled: z.boolean(),
    // Required (no default): PUT is full-replace, so an omitted list must be a 400 — a defaulted []
    // would silently wipe the stored allowlist.
    siweAllowedDomains: siweDomainField.array().max(20)
});
