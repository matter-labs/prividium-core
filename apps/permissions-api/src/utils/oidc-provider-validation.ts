import ipaddr from 'ipaddr.js';
import { InvalidInputError } from './error-types';

// IP ranges (per ipaddr.js) a JWKS endpoint must never resolve to. The permissions-api fetches the
// jwksUri server-side, so an attacker-supplied internal address would be an SSRF vector.
const DISALLOWED_IP_RANGES = new Set([
    'unspecified',
    'broadcast',
    'loopback',
    'linkLocal',
    'carrierGradeNat',
    'private',
    'reserved',
    'uniqueLocal',
    'ipv4Mapped'
]);

/**
 * Validates an organization's OIDC `jwksUri` before it is persisted. Requires HTTPS and rejects hosts
 * that are an IP literal in a private/loopback/link-local range (or `localhost`). DNS-rebinding via a
 * public hostname resolving to an internal IP is out of scope here — the timeout-bounded fetch in
 * `JwtValidatorService` is the second line of defense.
 */
// A browser redirect target, never fetched server-side (no SSRF surface, unlike jwksUri) — so plain
// http is fine for local dev.
export function assertValidUserPanelUrl(userPanelUrl: string): void {
    let url: URL;
    try {
        url = new URL(userPanelUrl);
    } catch {
        throw new InvalidInputError('userPanelUrl must be a valid URL');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new InvalidInputError('userPanelUrl must use http(s)');
    }
}

export function assertValidJwksUri(jwksUri: string): void {
    let url: URL;
    try {
        url = new URL(jwksUri);
    } catch {
        throw new InvalidInputError('jwksUri must be a valid URL');
    }

    if (url.protocol !== 'https:') {
        throw new InvalidInputError('jwksUri must use https');
    }

    // URL keeps IPv6 hosts wrapped in brackets; strip them before parsing.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host.toLowerCase() === 'localhost') {
        throw new InvalidInputError('jwksUri must not target localhost');
    }

    if (ipaddr.isValid(host)) {
        const range = ipaddr.parse(host).range();
        if (DISALLOWED_IP_RANGES.has(range)) {
            throw new InvalidInputError(`jwksUri must not target a ${range} address`);
        }
    }
}
