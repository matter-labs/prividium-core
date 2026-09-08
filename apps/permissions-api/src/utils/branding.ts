// Write-time gate for organization branding, mirroring the render-time checks the panels apply —
// same names and bodies as the panels' shared branding-safety helpers, so drift shows up as a
// diff between the two files. Values are stored canonical, so nothing re-reads the raw string.

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const RELATIVE_BASE = 'https://logo.invalid';

export function isValidHexColor(value: string): boolean {
    return HEX_COLOR.test(value);
}

/**
 * Canonical form of a logo the panels can load — a path on their own origin, or a TLS-only URL — else ''.
 * Parsing settles `\`, whitespace and `..` before the decision, as `assertValidJwksUri` does for its input.
 */
export function sanitizeLogoUrl(value: string): string {
    if (value.trim() === '') return '';

    let url: URL;
    try {
        url = new URL(value, RELATIVE_BASE);
    } catch {
        return '';
    }

    if (url.protocol !== 'https:') return '';
    return url.origin === RELATIVE_BASE ? `${url.pathname}${url.search}${url.hash}` : url.href;
}
