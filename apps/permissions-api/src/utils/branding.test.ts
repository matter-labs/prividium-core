import { describe, expect, it } from 'vitest';
import { isValidHexColor, sanitizeLogoUrl } from './branding';

describe('sanitizeLogoUrl', () => {
    it.each([
        ['/prividium_logo.svg', '/prividium_logo.svg'],
        ['/custom-chain-logo.svg', '/custom-chain-logo.svg'],
        ['/a/b/c.png?v=2', '/a/b/c.png?v=2'],
        ['https://acme.example.com/logo.svg', 'https://acme.example.com/logo.svg'],
        ['HTTPS://acme.example.com/logo.svg', 'https://acme.example.com/logo.svg'],
        // Canonicalised rather than rejected: each of these has exactly one meaning once parsed.
        [' https://acme.example.com/l.svg ', 'https://acme.example.com/l.svg'],
        ['/assets/../logo.svg', '/logo.svg'],
        ['/../../etc/passwd', '/etc/passwd'],
        ['logo.svg', '/logo.svg']
    ])('normalises %j to %j', (value, expected) => {
        expect(sanitizeLogoUrl(value)).toBe(expected);
    });

    it.each([
        'http://acme.example.com/l.svg',
        'javascript:alert(1)',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        ''
    ])('rejects %j', (value) => {
        expect(sanitizeLogoUrl(value)).toBe('');
    });

    // Storing the parsed result means the browser cannot later read these as something else.
    it('resolves off-origin forms to an explicit https URL', () => {
        expect(sanitizeLogoUrl('//evil.example/x.svg')).toBe('https://evil.example/x.svg');
        expect(sanitizeLogoUrl('/\\evil.example/x.svg')).toBe('https://evil.example/x.svg');
    });
});

describe('isValidHexColor', () => {
    it.each(['#fff', '#FFF', '#3B82F6', '#000000'])('accepts %j', (value) => {
        expect(isValidHexColor(value)).toBe(true);
    });

    it.each([
        'blue',
        '#12345',
        '#gggggg',
        '',
        'rgb(0,0,0)',
        // The CSS sink echoes the value into a custom property, where url() would fetch.
        'url(https://attacker.example/leak)',
        '#fff; background-image: url(https://attacker.example/leak)'
    ])('rejects %j', (value) => {
        expect(isValidHexColor(value)).toBe(false);
    });
});
