import { z } from 'zod/v4';

/**
 * A CORS origin: a canonical `scheme://host[:port]` URL (http or https only).
 *
 * Rejects anything that isn't already normalized — credentials, wildcards, and
 * any path/query/fragment — so the stored value is safe to compare verbatim
 * against the browser-supplied `Origin` header.
 */
export const CorsOriginSchema = z
    .url({
        message: 'Origin must be a valid URL starting with http:// or https://',
        protocol: /^https?$/
    })
    .superRefine((value, ctx) => {
        // A comma is a valid URL hostname char, so lists parse to a junk origin, not an error.
        if (value.includes(',')) {
            ctx.addIssue({
                code: 'custom',
                message: 'Origin must be a single origin; commas and lists are not allowed'
            });
            return;
        }

        // `.url()` runs first but does not abort the chain, so guard against
        // values it already rejected (e.g. '' or a bare host) reaching `new URL`.
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return;
        }

        // No credentials
        if (url.username || url.password) {
            ctx.addIssue({
                code: 'custom',
                message: 'Origin must not contain username or password'
            });
            return;
        }

        // No wildcards (defensive)
        if (url.hostname.includes('%2A') || url.hostname.includes('*')) {
            ctx.addIssue({
                code: 'custom',
                message: 'Wildcards are not allowed in origins'
            });
            return;
        }

        // Must already be canonical: scheme://host[:port], normalized, no path/query/fragment.
        if (value !== url.origin) {
            ctx.addIssue({
                code: 'custom',
                message: 'Origin must be normalized and not contain path, query, or fragment'
            });
            return;
        }
    });
