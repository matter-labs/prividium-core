import { describe, expect, it } from 'vitest';
import { InvalidInputError } from './error-types';
import { assertValidJwksUri, assertValidUserPanelUrl } from './oidc-provider-validation';

describe('assertValidUserPanelUrl', () => {
    it.each([
        ['an https URL', 'https://user-panel.acme.example.com'],
        ['an http URL (local dev)', 'http://localhost:3001']
    ])('accepts %s', (_label, url) => {
        expect(() => assertValidUserPanelUrl(url)).not.toThrow();
    });

    it.each([
        ['not a URL', 'not a url'],
        ['a non-http scheme', 'javascript:alert(1)']
    ])('rejects %s', (_label, url) => {
        expect(() => assertValidUserPanelUrl(url)).toThrow(InvalidInputError);
    });
});

describe('assertValidJwksUri', () => {
    it('accepts an https URL with a public host', () => {
        expect(() => assertValidJwksUri('https://acme.example.com/.well-known/jwks.json')).not.toThrow();
    });

    it.each([
        ['not a URL', 'not a url'],
        ['http instead of https', 'http://acme.example.com/jwks'],
        ['localhost', 'https://localhost/jwks'],
        ['loopback IPv4', 'https://127.0.0.1/jwks'],
        ['private IPv4 (10/8)', 'https://10.0.0.1/jwks'],
        ['private IPv4 (192.168/16)', 'https://192.168.1.1/jwks'],
        ['link-local IPv4', 'https://169.254.1.1/jwks'],
        ['unspecified IPv4', 'https://0.0.0.0/jwks'],
        ['loopback IPv6', 'https://[::1]/jwks']
    ])('rejects %s', (_label, uri) => {
        expect(() => assertValidJwksUri(uri)).toThrow(InvalidInputError);
    });
});
