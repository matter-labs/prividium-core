import { z } from 'zod/v4';
import { applicationsTable } from '../../db/schema';
import { nameField } from '../../repositories/shared-schemas';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { CorsOriginSchema } from '../../utils/schemas/cors-origin';
import { paginatedResult } from '../../utils/schemas/pagination';

// No value refinements here — a stored row failing them would 500 every read; strictness belongs on write bodies.
export const ApplicationSchema = createSelectSchema(applicationsTable);

export const PaginatedApplicationsSchema = paginatedResult(ApplicationSchema);

function parseHttpUrl(value: string): URL | null {
    try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) ? url : null;
    } catch {
        return null;
    }
}

// Protocol allowlist keeps javascript:/data:/other schemes out of the OAuth redirect allow-list.
export const RedirectUriSchema = z
    .url({ message: 'Redirect URI must be a valid http(s) URL', protocol: /^https?$/ })
    // Reject a comma-joined list (a URL sits after a comma) but allow a comma inside one URL's path/query.
    .refine(
        (value) =>
            !value
                .split(',')
                .slice(1)
                .some((segment) => parseHttpUrl(segment.trim())),
        {
            message: 'Enter one redirect URI per field; comma-separated lists are not allowed'
        }
    );

// oauthClientId is server-generated; never accept it from the client
export const CreateApplicationBodySchema = createInsertSchema(applicationsTable, {
    name: nameField,
    origin: () => CorsOriginSchema,
    oauthRedirectUris: () => z.array(RedirectUriSchema),
    description: (v) => v.max(200),
    imageUrl: () => z.url()
}).omit({ ...MANAGED_COLUMNS, oauthClientId: true });

export const UpdateApplicationBodySchema = CreateApplicationBodySchema.required();

export const PublicApplicationSchema = ApplicationSchema.pick({
    oauthClientId: true,
    oauthRedirectUris: true,
    name: true
});

export const PublicApplicationCardSchema = ApplicationSchema.pick({
    id: true,
    name: true,
    description: true,
    imageUrl: true,
    origin: true
});
