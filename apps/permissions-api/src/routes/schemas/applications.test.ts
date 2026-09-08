import { describe, expect, it } from 'vitest';
import { ApplicationSchema, CreateApplicationBodySchema, RedirectUriSchema } from './applications';

const dbRow = {
    id: 'woFN3Ckut8p5SbWrwHJia',
    name: 'legacy app',
    oauthClientId: 'client-id',
    oauthRedirectUris: ['https://app.example.com/callback'],
    origin: 'https://app.example.com/',
    isPublic: false,
    description: null,
    imageUrl: null,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    updatedAt: new Date('2025-12-01T00:00:00Z')
};

describe('ApplicationSchema (response)', () => {
    it('accepts a stored row with a non-normalized origin', () => {
        const result = ApplicationSchema.safeParse(dbRow);
        expect(result.success).toBe(true);
    });

    it('accepts a stored row with a null origin', () => {
        const result = ApplicationSchema.safeParse({ ...dbRow, origin: null });
        expect(result.success).toBe(true);
    });

    it('accepts a stored row with a non-URL imageUrl', () => {
        const result = ApplicationSchema.safeParse({ ...dbRow, imageUrl: 'not-a-url' });
        expect(result.success).toBe(true);
    });
});

describe('CreateApplicationBodySchema (write)', () => {
    it('still rejects a non-normalized origin', () => {
        const result = CreateApplicationBodySchema.safeParse({
            name: 'app',
            oauthRedirectUris: [],
            origin: 'https://app.example.com/'
        });
        expect(result.success).toBe(false);
    });

    it('accepts a canonical origin', () => {
        const result = CreateApplicationBodySchema.safeParse({
            name: 'app',
            oauthRedirectUris: [],
            origin: 'https://app.example.com'
        });
        expect(result.success).toBe(true);
    });

    it('rejects a body with a non-http(s) redirect URI', () => {
        const result = CreateApplicationBodySchema.safeParse({
            name: 'app',
            oauthRedirectUris: ['javascript:alert(1)'],
            origin: 'https://app.example.com'
        });
        expect(result.success).toBe(false);
    });

    it('accepts a body with valid redirect URIs', () => {
        const result = CreateApplicationBodySchema.safeParse({
            name: 'app',
            oauthRedirectUris: ['https://app.example.com/callback', 'http://localhost:3000/cb'],
            origin: 'https://app.example.com'
        });
        expect(result.success).toBe(true);
    });
});

describe('RedirectUriSchema', () => {
    describe('valid redirect URIs', () => {
        it.each([
            'https://app.example.com/callback',
            'http://localhost:3000/callback',
            'http://127.0.0.1:24101/callback',
            'https://app.example.com',
            'https://app.example.com/cb?ids=1,2,3',
            'https://app.example.com/a,b/callback'
        ])('accepts %s', (uri) => {
            expect(RedirectUriSchema.safeParse(uri).success).toBe(true);
        });
    });

    describe('invalid redirect URIs — bad scheme / not a URL', () => {
        it.each([
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'ftp://example.com',
            'mailto:user@example.com',
            'not-a-url-at-all',
            'app.example.com/callback',
            ''
        ])('rejects %s', (uri) => {
            expect(RedirectUriSchema.safeParse(uri).success).toBe(false);
        });

        it('rejects a non-string value', () => {
            expect(RedirectUriSchema.safeParse(123).success).toBe(false);
        });
    });

    describe('invalid redirect URIs — comma-separated list of valid URLs', () => {
        it.each([
            'https://a.com/callback,https://b.com/callback',
            'https://a.com/cb,https://b.com/cb,https://c.com/cb',
            'http://localhost:8080/cb,http://localhost:8081/cb',
            'https://a.com/cb, https://b.com/cb'
        ])('rejects %s', (uri) => {
            const result = RedirectUriSchema.safeParse(uri);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe(
                'Enter one redirect URI per field; comma-separated lists are not allowed'
            );
        });
    });
});
