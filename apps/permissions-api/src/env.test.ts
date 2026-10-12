import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    findDatabasePasswordConflict,
    findDatabaseTlsConflict,
    findTargetChainTypeConflict,
    loadEnv,
    shouldRequirePolicyAuthToken,
    shouldRequirePolicyListener
} from './env';

describe('shouldRequirePolicyListener', () => {
    it('returns true when multi-org is on and the opt-out is unset', () => {
        expect(
            shouldRequirePolicyListener({ MULTI_ORG_ENABLED: true, INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: false })
        ).toBe(true);
    });

    it('returns false when multi-org is off', () => {
        expect(
            shouldRequirePolicyListener({ MULTI_ORG_ENABLED: false, INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: false })
        ).toBe(false);
    });

    it('returns false when the opt-out is set', () => {
        expect(
            shouldRequirePolicyListener({ MULTI_ORG_ENABLED: true, INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED: true })
        ).toBe(false);
    });
});

describe('shouldRequirePolicyAuthToken', () => {
    it('returns true whenever a policy port is set', () => {
        expect(shouldRequirePolicyAuthToken({ POLICY_PORT: 8010 })).toBe(true);
    });

    it('returns false when no policy port is set', () => {
        expect(shouldRequirePolicyAuthToken({})).toBe(false);
        expect(shouldRequirePolicyAuthToken({ POLICY_PORT: undefined })).toBe(false);
    });
});

// The committed .env.example is a complete, valid configuration. Parsing it as the baseline
// keeps these tests in sync with the documented env contract instead of hard-coding ~70 vars.
const EXAMPLE_ENV = parse(readFileSync(fileURLToPath(new URL('../.env.example', import.meta.url))));
const TEST_SIWE_HMAC_SECRET = '444556204f4e4c5920686d61632073656372657420646f206e6f742075736521';

// Well-known config vars added by the unified config endpoint. All are required.
const WELL_KNOWN_REQUIRED = [
    'CHAIN_NAME',
    'NATIVE_TOKEN_NAME',
    'NATIVE_TOKEN_SYMBOL',
    'NATIVE_TOKEN_DECIMALS',
    'BLOCK_EXPLORER_URL',
    'PRIVIDIUM_API_URL',
    'L1_CHAIN_ID',
    'L1_CHAIN_NAME'
] as const;

describe('loadEnv', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('parses the example configuration and coerces well-known fields to their types', () => {
        const env = loadEnv();

        expect(env.NATIVE_TOKEN_DECIMALS).toBe(18);
        expect(typeof env.L1_CHAIN_ID).toBe('number');
        expect(env.PRIVIDIUM_API_URL).toBe(EXAMPLE_ENV.PRIVIDIUM_API_URL);
        expect(env.BLOCK_EXPLORER_URL).toBe(EXAMPLE_ENV.BLOCK_EXPLORER_URL);
        expect(env.USER_PANEL_URL).toBe(EXAMPLE_ENV.USER_PANEL_URL);
        expect(env.CHAIN_NAME).toBe(EXAMPLE_ENV.CHAIN_NAME);
    });

    it.each(WELL_KNOWN_REQUIRED)('throws when required well-known var %s is missing', (key) => {
        delete process.env[key];
        expect(() => loadEnv()).toThrow();
    });

    it('requires USER_PANEL_URL unconditionally, independent of Swagger/WebAuthn config', () => {
        // USER_PANEL_URL is now always required (the well-known userPanelUrl). Removing the
        // SWAGGER_UI_ALLOWED_ROLES gate must not make it optional.
        delete process.env.SWAGGER_UI_ALLOWED_ROLES;
        delete process.env.USER_PANEL_URL;
        expect(() => loadEnv()).toThrow();
    });

    it('rejects a non-URL USER_PANEL_URL', () => {
        process.env.USER_PANEL_URL = 'not-a-url';
        expect(() => loadEnv()).toThrow();
    });

    it('treats NATIVE_TOKEN_L1_ADDRESS as optional', () => {
        delete process.env.NATIVE_TOKEN_L1_ADDRESS;
        expect(() => loadEnv()).not.toThrow();
        expect(loadEnv().NATIVE_TOKEN_L1_ADDRESS).toBeUndefined();
    });

    it('rejects an invalid NATIVE_TOKEN_L1_ADDRESS', () => {
        process.env.NATIVE_TOKEN_L1_ADDRESS = 'not-an-address';
        expect(() => loadEnv()).toThrow();
    });

    it.each([undefined, '', 'false', 'true'])('parses the umbrella read opt-in %s', (value) => {
        if (value === undefined) delete process.env.ALLOW_UMBRELLA_SYSTEM_READS;
        else process.env.ALLOW_UMBRELLA_SYSTEM_READS = value;
        expect(loadEnv().ALLOW_UMBRELLA_SYSTEM_READS).toBe(value === 'true');
    });

    it.each(['1', 'yes', 'TRUE'])('rejects an invalid umbrella read opt-in %s', (value) => {
        process.env.ALLOW_UMBRELLA_SYSTEM_READS = value;
        expect(() => loadEnv()).toThrow();
    });

    it('treats SWAGGER_DOCS_REDIRECT_URLS as optional, defaulting to an empty list', () => {
        delete process.env.SWAGGER_DOCS_REDIRECT_URLS;
        expect(loadEnv().SWAGGER_DOCS_REDIRECT_URLS).toEqual([]);
    });

    it('treats an empty SWAGGER_DOCS_REDIRECT_URLS as unset', () => {
        process.env.SWAGGER_DOCS_REDIRECT_URLS = '';
        expect(loadEnv().SWAGGER_DOCS_REDIRECT_URLS).toEqual([]);
    });

    it('parses a comma-separated SWAGGER_DOCS_REDIRECT_URLS', () => {
        process.env.SWAGGER_DOCS_REDIRECT_URLS =
            'https://api.a.example.com/docs/callback,https://api.b.example.com/docs/callback';
        expect(loadEnv().SWAGGER_DOCS_REDIRECT_URLS).toEqual([
            'https://api.a.example.com/docs/callback',
            'https://api.b.example.com/docs/callback'
        ]);
    });

    it('rejects a non-URL SWAGGER_DOCS_REDIRECT_URLS', () => {
        process.env.SWAGGER_DOCS_REDIRECT_URLS = 'not-a-url';
        expect(() => loadEnv()).toThrow();
    });

    it('defaults PASSKEY_REGISTRATION_ENABLED to true when unset', () => {
        delete process.env.PASSKEY_REGISTRATION_ENABLED;
        expect(loadEnv().PASSKEY_REGISTRATION_ENABLED).toBe(true);
    });

    it('turns PASSKEY_REGISTRATION_ENABLED off only on an explicit false', () => {
        process.env.PASSKEY_REGISTRATION_ENABLED = 'false';
        expect(loadEnv().PASSKEY_REGISTRATION_ENABLED).toBe(false);
    });

    it('requires SIWE_HMAC_SECRET for wallet association when crypto_native is off', () => {
        process.env.AUTH_METHODS = 'oidc';
        delete process.env.SIWE_HMAC_SECRET;
        expect(() => loadEnv()).toThrow();
    });
});

describe('policy listener validation (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('parses the example configuration, which runs single-org with no policy listener', () => {
        expect(EXAMPLE_ENV.MULTI_ORG_ENABLED).toBe('false');
        expect(EXAMPLE_ENV.POLICY_PORT).toBeUndefined();
        expect(EXAMPLE_ENV.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED).toBe('false');
        expect(() => loadEnv()).not.toThrow();
    });

    it('throws when MULTI_ORG_ENABLED is true with no POLICY_PORT', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        expect(() => loadEnv()).toThrow();
    });

    it('throws regardless of NODE_ENV, which the image bakes to production', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.SIWE_HMAC_SECRET = TEST_SIWE_HMAC_SECRET;
        for (const nodeEnv of ['development', 'test', 'production']) {
            process.env.NODE_ENV = nodeEnv;
            expect(() => loadEnv()).toThrow();
        }
    });

    it('accepts MULTI_ORG_ENABLED with no POLICY_PORT when the insecure opt-out is set', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED = 'true';
        expect(() => loadEnv()).not.toThrow();
    });

    it('accepts MULTI_ORG_ENABLED once the policy listener is configured', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.POLICY_PORT = '8010';
        process.env.POLICY_AUTH_TOKEN = 'shared-secret';
        expect(() => loadEnv()).not.toThrow();
    });

    it('still requires POLICY_AUTH_TOKEN when the insecure opt-out is set alongside a port', () => {
        process.env.MULTI_ORG_ENABLED = 'true';
        process.env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED = 'true';
        process.env.POLICY_PORT = '8010';
        expect(() => loadEnv()).toThrow();
    });

    it('throws when POLICY_PORT is set without POLICY_AUTH_TOKEN', () => {
        process.env.POLICY_PORT = '8010';
        expect(() => loadEnv()).toThrow();
    });

    it('throws when POLICY_PORT is set with an empty POLICY_AUTH_TOKEN', () => {
        process.env.POLICY_PORT = '8010';
        process.env.POLICY_AUTH_TOKEN = '';
        expect(() => loadEnv()).toThrow();
    });
});

describe('SIWE_HMAC_SECRET validation (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;
    const PLACEHOLDER = 'aaaaaaaa00000000aaaaaaaa00000000aaaaaaaa00000000aaaaaaaa00000000';

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it.each(['development', 'test'])('accepts the .env.example placeholder when NODE_ENV is %s', (nodeEnv) => {
        process.env.NODE_ENV = nodeEnv;
        expect(() => loadEnv()).not.toThrow();
    });

    it('refuses the .env.example placeholder when NODE_ENV is production', () => {
        process.env.NODE_ENV = 'production';
        expect(() => loadEnv()).toThrow();
    });

    it.each([
        ['in upper case', PLACEHOLDER.toUpperCase()],
        ['as a rotation entry', `${TEST_SIWE_HMAC_SECRET}, ${PLACEHOLDER}`]
    ])('refuses the placeholder %s when NODE_ENV is production', (_form, secret) => {
        process.env.NODE_ENV = 'production';
        process.env.SIWE_HMAC_SECRET = secret;
        expect(() => loadEnv()).toThrow();
    });

    it('accepts any other secret when NODE_ENV is production', () => {
        process.env.NODE_ENV = 'production';
        process.env.SIWE_HMAC_SECRET = TEST_SIWE_HMAC_SECRET;
        expect(() => loadEnv()).not.toThrow();
    });
});

describe('secret files and the database URL (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;
    const dir = mkdtempSync(join(tmpdir(), 'env-secrets-'));

    function secretFile(name: string, contents: string): string {
        const path = join(dir, name);
        writeFileSync(path, contents);
        return path;
    }

    const components = {
        DATABASE_HOST: 'db.internal',
        DATABASE_PORT: '5432',
        DATABASE_USER: 'app',
        DATABASE_NAME: 'prividium_api'
    };

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('reads DATABASE_URL from DATABASE_URL_FILE', () => {
        delete process.env.DATABASE_URL;
        process.env.DATABASE_URL_FILE = secretFile('database-url', 'postgres://app:from-file@db:5432/app\n');
        expect(loadEnv().DATABASE_URL).toBe('postgres://app:from-file@db:5432/app');
    });

    it('reads POLICY_AUTH_TOKEN from POLICY_AUTH_TOKEN_FILE', () => {
        process.env.POLICY_PORT = '8010';
        process.env.POLICY_AUTH_TOKEN_FILE = secretFile('policy-token', 'shared-secret\n');
        expect(loadEnv().POLICY_AUTH_TOKEN).toBe('shared-secret');
    });

    it('refuses DATABASE_URL beside DATABASE_URL_FILE', () => {
        process.env.DATABASE_URL_FILE = secretFile('database-url-both', 'postgres://app:x@db:5432/app');
        expect(() => loadEnv()).toThrow('DATABASE_URL and DATABASE_URL_FILE are both set');
    });

    it('encodes the user and password into the URL built from the components', () => {
        delete process.env.DATABASE_URL;
        Object.assign(process.env, components, { DATABASE_USER: 'app@ops', DATABASE_PASSWORD: 'p/w#d?%41 x' });
        const url = new URL(loadEnv().DATABASE_URL);
        expect(decodeURIComponent(url.username)).toBe('app@ops');
        expect(decodeURIComponent(url.password)).toBe('p/w#d?%41 x');
        expect(url.hostname).toBe('db.internal');
    });

    it('builds a password-less URL from the components when a provider supplies the credential', () => {
        delete process.env.DATABASE_URL;
        Object.assign(process.env, components, {
            DATABASE_AUTH: 'iam-token',
            DATABASE_ENABLE_SSL: 'true',
            DATABASE_SSL_REJECT_UNAUTHORIZED: 'true'
        });
        expect(loadEnv().DATABASE_URL).toBe('postgres://app@db.internal:5432/prividium_api');
    });

    it('refuses a password read from DATABASE_PASSWORD_FILE outside password auth', () => {
        Object.assign(process.env, {
            DATABASE_AUTH: 'iam-token',
            DATABASE_URL: 'postgres://app@db.internal:5432/prividium_api?sslmode=verify-full'
        });
        expect(() => loadEnv()).not.toThrow();
        process.env.DATABASE_PASSWORD_FILE = secretFile('database-password', 'leftover\n');
        expect(() => loadEnv()).toThrow();
    });

    it('refuses a password inside DATABASE_URL_FILE outside password auth', () => {
        delete process.env.DATABASE_URL;
        process.env.DATABASE_AUTH = 'iam-token';
        process.env.DATABASE_URL_FILE = secretFile(
            'database-url-without-password',
            'postgres://app@db.internal:5432/prividium_api?sslmode=verify-full\n'
        );
        expect(() => loadEnv()).not.toThrow();
        process.env.DATABASE_URL_FILE = secretFile(
            'database-url-with-password',
            'postgres://app:leftover@db.internal:5432/prividium_api?sslmode=verify-full\n'
        );
        expect(() => loadEnv()).toThrow();
    });

    it('still requires DATABASE_PASSWORD with the components under password auth', () => {
        delete process.env.DATABASE_URL;
        Object.assign(process.env, components);
        expect(() => loadEnv()).toThrow();
    });
});

describe('database auth and connection lifetime (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;
    const PASSWORDLESS_URL = 'postgres://app@db.internal:5432/prividium_api?sslmode=verify-full';

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('defaults to password auth and a 30-minute connection lifetime', () => {
        delete process.env.DATABASE_AUTH;
        delete process.env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS;
        const env = loadEnv();
        expect(env.DATABASE_AUTH).toBe('password');
        expect(env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS).toBe(1800);
    });

    it('reads the connection lifetime, where 0 disables recycling and blank keeps the default', () => {
        process.env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS = '0';
        expect(loadEnv().DATABASE_MAX_CONNECTION_LIFETIME_SECONDS).toBe(0);
        process.env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS = '';
        expect(loadEnv().DATABASE_MAX_CONNECTION_LIFETIME_SECONDS).toBe(1800);
    });

    it('refuses a negative connection lifetime', () => {
        process.env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS = '-1';
        expect(() => loadEnv()).toThrow();
    });

    it('caps the connection lifetime at the longest timer Node schedules', () => {
        process.env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS = '2147483';
        expect(loadEnv().DATABASE_MAX_CONNECTION_LIFETIME_SECONDS).toBe(2_147_483);
        process.env.DATABASE_MAX_CONNECTION_LIFETIME_SECONDS = '2147484';
        expect(() => loadEnv()).toThrow();
    });

    it('accepts a mode it does not know, leaving boot to find the provider that claims it', () => {
        Object.assign(process.env, { DATABASE_AUTH: 'iam-token', DATABASE_URL: PASSWORDLESS_URL });
        expect(loadEnv()).toMatchObject({ DATABASE_AUTH: 'iam-token', DATABASE_URL: PASSWORDLESS_URL });
    });

    it.each([
        [
            'a password in DATABASE_URL',
            { DATABASE_URL: 'postgres://app:leftover@db.internal:5432/prividium_api?sslmode=verify-full' }
        ],
        ['DATABASE_PASSWORD', { DATABASE_URL: PASSWORDLESS_URL, DATABASE_PASSWORD: 'leftover' }],
        ['PGPASSWORD', { DATABASE_URL: PASSWORDLESS_URL, PGPASSWORD: 'leftover' }]
    ])('refuses %s outside password auth', (_leftover, vars) => {
        Object.assign(process.env, { DATABASE_AUTH: 'iam-token', ...vars });
        expect(() => loadEnv()).toThrow();
    });

    it('leaves every password alone under password auth', () => {
        Object.assign(process.env, { DATABASE_PASSWORD: 'unused', PGPASSWORD: 'unused' });
        expect(loadEnv().DATABASE_URL).toBe(EXAMPLE_ENV.DATABASE_URL);
    });
});

describe('findDatabasePasswordConflict', () => {
    const PASSWORDLESS_URL = 'postgres://app@db.internal:5432/prividium_api';
    const REASON = 'DATABASE_AUTH=iam-token supplies the database credential';

    it('finds nothing under password auth, wherever a password sits', () => {
        expect(
            findDatabasePasswordConflict({
                DATABASE_AUTH: 'password',
                DATABASE_URL: 'postgres://app:secret@db/app',
                DATABASE_PASSWORD: 'secret',
                PGPASSWORD: 'secret'
            })
        ).toBeUndefined();
    });

    it('finds nothing when a provider mode has no password anywhere', () => {
        expect(
            findDatabasePasswordConflict({ DATABASE_AUTH: 'iam-token', DATABASE_URL: PASSWORDLESS_URL })
        ).toBeUndefined();
    });

    it.each([
        ['userinfo', 'postgres://app:leftover@db.internal:5432/prividium_api'],
        ['the query string', 'postgres://app@db.internal:5432/prividium_api?password=leftover'],
        ['an unreadable sslrootcert', 'postgres://app@db.internal:5432/prividium_api?sslrootcert=/nonexistent/ca.pem']
    ])('refuses DATABASE_URL carrying a password in %s', (_where, url) => {
        const conflict = findDatabasePasswordConflict({ DATABASE_AUTH: 'iam-token', DATABASE_URL: url });
        expect(conflict?.variable).toBe('DATABASE_URL');
        expect(conflict?.message).toContain('DATABASE_URL must not carry a password');
        expect(conflict?.message).toContain(REASON);
    });

    it('refuses DATABASE_PASSWORD', () => {
        const conflict = findDatabasePasswordConflict({
            DATABASE_AUTH: 'iam-token',
            DATABASE_URL: PASSWORDLESS_URL,
            DATABASE_PASSWORD: 'leftover'
        });
        expect(conflict?.variable).toBe('DATABASE_PASSWORD');
        expect(conflict?.message).toContain('DATABASE_PASSWORD (or DATABASE_PASSWORD_FILE) must be unset');
        expect(conflict?.message).toContain(REASON);
    });

    it('refuses PGPASSWORD', () => {
        const conflict = findDatabasePasswordConflict({
            DATABASE_AUTH: 'iam-token',
            DATABASE_URL: PASSWORDLESS_URL,
            PGPASSWORD: 'leftover'
        });
        expect(conflict?.variable).toBe('PGPASSWORD');
        expect(conflict?.message).toContain('PGPASSWORD must be unset');
        expect(conflict?.message).toContain(REASON);
    });
});

describe('findDatabaseTlsConflict', () => {
    const at = (query: string) => `postgres://app@db.internal:5432/prividium_api${query}`;
    const verifiedEnv = { DATABASE_ENABLE_SSL: true, DATABASE_SSL_REJECT_UNAUTHORIZED: true };
    const conflict = (url: string, env = { DATABASE_ENABLE_SSL: false, DATABASE_SSL_REJECT_UNAUTHORIZED: false }) =>
        findDatabaseTlsConflict({ DATABASE_AUTH: 'iam-token', DATABASE_URL: url, ...env });

    it('checks nothing under password auth', () => {
        expect(
            findDatabaseTlsConflict({
                DATABASE_AUTH: 'password',
                DATABASE_URL: at('?sslmode=disable'),
                DATABASE_ENABLE_SSL: false,
                DATABASE_SSL_REJECT_UNAUTHORIZED: false
            })
        ).toBeUndefined();
    });

    it('accepts sslmode=verify-full, whatever the env pair says', () => {
        expect(conflict(at('?sslmode=verify-full'))).toBeUndefined();
        expect(conflict(at('?uselibpqcompat=true&sslmode=verify-full'))).toBeUndefined();
    });

    it('accepts sslmode=verify-full with an sslrootcert', () => {
        const dir = mkdtempSync(join(tmpdir(), 'env-tls-'));
        try {
            const ca = join(dir, 'ca.pem');
            writeFileSync(ca, 'not parsed here');
            expect(conflict(at(`?sslmode=verify-full&sslrootcert=${ca}`))).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('accepts a URL with no SSL parameter when the env pair verifies the server', () => {
        expect(conflict(at(''), verifiedEnv)).toBeUndefined();
    });

    it.each([
        ['?sslmode=disable', 'sslmode=disable'],
        ['?sslmode=no-verify', 'sslmode=no-verify'],
        ['?ssl=0', 'ssl=0'],
        ['?uselibpqcompat=true&sslmode=require', 'sslmode=require with uselibpqcompat=true'],
        ['?uselibpqcompat=true&sslmode=prefer', 'sslmode=prefer with uselibpqcompat=true'],
        ['?sslmode=require', 'sslmode=require'],
        ['?sslmode=prefer', 'sslmode=prefer'],
        ['?sslmode=verify-ca', 'sslmode=verify-ca'],
        ['?sslmode=verify-full&sslmode=disable', 'sslmode=disable']
    ])('refuses %s, naming the effective setting', (query, effective) => {
        // Even beside an env pair that would verify: the URL's setting is the one pg uses.
        const message = conflict(at(query), verifiedEnv);
        expect(message).toContain(`DATABASE_URL requests ${effective}, which does not guarantee a verified server`);
        expect(message).toContain('set sslmode=verify-full in DATABASE_URL');
    });

    it('refuses a socket: URL, whose SSL parameters pg does not apply', () => {
        expect(
            conflict('socket:db.internal?db=prividium_api&user=app&ssl=1&sslmode=verify-full', verifiedEnv)
        ).toContain('DATABASE_URL must be a postgres:// or postgresql:// URL');
    });

    it('refuses NODE_TLS_REJECT_UNAUTHORIZED=0, which unverifies even sslmode=verify-full', () => {
        const refused = (value: string | undefined) =>
            findDatabaseTlsConflict({
                DATABASE_AUTH: 'iam-token',
                DATABASE_URL: at('?sslmode=verify-full'),
                ...verifiedEnv,
                NODE_TLS_REJECT_UNAUTHORIZED: value
            });
        expect(refused('0')).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0 turns off server certificate checks');
        expect(refused('1')).toBeUndefined();
        expect(refused(undefined)).toBeUndefined();
        expect(
            findDatabaseTlsConflict({
                DATABASE_AUTH: 'password',
                DATABASE_URL: at(''),
                ...verifiedEnv,
                NODE_TLS_REJECT_UNAUTHORIZED: '0'
            })
        ).toBeUndefined();
    });

    it('accepts the postgresql: scheme', () => {
        expect(conflict(at('?sslmode=verify-full').replace('postgres:', 'postgresql:'))).toBeUndefined();
    });

    it('refuses uselibpqcompat=true with sslmode=verify-ca', () => {
        // pg refuses to parse verify-ca without an sslrootcert under libpq semantics, and with one it skips the hostname.
        const dir = mkdtempSync(join(tmpdir(), 'env-tls-'));
        try {
            const ca = join(dir, 'ca.pem');
            writeFileSync(ca, 'not parsed here');
            expect(conflict(at(`?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=${ca}`), verifiedEnv)).toContain(
                'DATABASE_URL requests sslmode=verify-ca with uselibpqcompat=true'
            );
            expect(conflict(at('?uselibpqcompat=true&sslmode=verify-ca'), verifiedEnv)).toContain(
                'DATABASE_URL cannot be parsed'
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses no SSL parameter with DATABASE_ENABLE_SSL=false', () => {
        expect(conflict(at(''), { DATABASE_ENABLE_SSL: false, DATABASE_SSL_REJECT_UNAUTHORIZED: true })).toContain(
            'DATABASE_URL names no SSL parameter and DATABASE_ENABLE_SSL=false'
        );
    });

    it('refuses no SSL parameter with DATABASE_SSL_REJECT_UNAUTHORIZED=false', () => {
        expect(conflict(at(''), { DATABASE_ENABLE_SSL: true, DATABASE_SSL_REJECT_UNAUTHORIZED: false })).toContain(
            'DATABASE_URL names no SSL parameter and DATABASE_SSL_REJECT_UNAUTHORIZED=false'
        );
    });

    it('is enforced by loadEnv', () => {
        const ORIGINAL_ENV = process.env;
        process.env = { ...EXAMPLE_ENV, DATABASE_AUTH: 'iam-token', DATABASE_URL: at('?sslmode=require') };
        try {
            expect(() => loadEnv()).toThrow();
            process.env.DATABASE_URL = at('?sslmode=verify-full');
            expect(() => loadEnv()).not.toThrow();
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
            expect(() => loadEnv()).toThrow();
        } finally {
            process.env = ORIGINAL_ENV;
        }
    });
});

describe('findTargetChainTypeConflict', () => {
    const base = { POLICY_PORT: undefined, MULTI_ORG_ENABLED: false, DISCLOSURE_METHODS_ENABLED: false };

    it('never conflicts on zksync-os', () => {
        expect(
            findTargetChainTypeConflict({
                TARGET_CHAIN_TYPE: 'zksync-os',
                POLICY_PORT: 8010,
                MULTI_ORG_ENABLED: true,
                DISCLOSURE_METHODS_ENABLED: true
            })
        ).toBeUndefined();
    });

    it('accepts besu with zksync-os-only config off', () => {
        expect(findTargetChainTypeConflict({ TARGET_CHAIN_TYPE: 'besu', ...base })).toBeUndefined();
    });

    it.each([
        ['POLICY_PORT', { POLICY_PORT: 8010 }],
        ['MULTI_ORG_ENABLED', { MULTI_ORG_ENABLED: true }],
        ['DISCLOSURE_METHODS_ENABLED', { DISCLOSURE_METHODS_ENABLED: true }]
    ] as const)('rejects besu with %s set', (variable, override) => {
        expect(findTargetChainTypeConflict({ TARGET_CHAIN_TYPE: 'besu', ...base, ...override })?.variable).toBe(
            variable
        );
    });
});

describe('TARGET_CHAIN_TYPE validation (via loadEnv)', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...EXAMPLE_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('defaults to zksync-os', () => {
        delete process.env.TARGET_CHAIN_TYPE;
        expect(loadEnv().TARGET_CHAIN_TYPE).toBe('zksync-os');
    });

    it('rejects unknown chain types', () => {
        process.env.TARGET_CHAIN_TYPE = 'geth';
        expect(() => loadEnv()).toThrow();
    });

    it('accepts besu with the example configuration', () => {
        process.env.TARGET_CHAIN_TYPE = 'besu';
        expect(loadEnv().TARGET_CHAIN_TYPE).toBe('besu');
    });

    it.each([
        ['POLICY_PORT', '8010'],
        ['MULTI_ORG_ENABLED', 'true'],
        ['DISCLOSURE_METHODS_ENABLED', 'true']
    ])('throws on besu with %s set', (key, value) => {
        process.env.TARGET_CHAIN_TYPE = 'besu';
        process.env[key] = value;
        if (key === 'POLICY_PORT') process.env.POLICY_AUTH_TOKEN = 'token';
        // MULTI_ORG_ENABLED=true also trips the POLICY_PORT-required check; the opt-out
        // disarms it so only the chain-type conflict can make this throw.
        if (key === 'MULTI_ORG_ENABLED') process.env.INSECURE_MULTI_ORG_WITHOUT_POLICY_ENABLED = 'true';
        expect(() => loadEnv()).toThrow();
    });

    it('boots on besu with L1_CHAIN_ID and L1_CHAIN_NAME both unset', () => {
        process.env.TARGET_CHAIN_TYPE = 'besu';
        delete process.env.L1_CHAIN_ID;
        delete process.env.L1_CHAIN_NAME;
        expect(() => loadEnv()).not.toThrow();
        const env = loadEnv();
        expect(env.L1_CHAIN_ID).toBeUndefined();
        expect(env.L1_CHAIN_NAME).toBeUndefined();
    });

    it('keeps L1_CHAIN_ID when it is set on besu', () => {
        process.env.TARGET_CHAIN_TYPE = 'besu';
        expect(loadEnv().L1_CHAIN_ID).toBe(31337);
    });
});

describe('USER_IDLE_TIMEOUT_SECONDS validation (via loadEnv)', () => {
    // Minimal complete env that passes loadEnv. Feature flags are forced off so the
    // parse depends only on the vars under test, not on ambient process.env values.
    const baseEnv: Record<string, string> = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/prividium_api',
        CORS_ORIGIN: 'http://localhost:3000',
        CORS_CACHE_DURATION_MS: '60000',
        SEQUENCER_RPC_URL: 'http://localhost:8545',
        CHAIN_NAME: 'Prividium Local',
        NATIVE_TOKEN_NAME: 'Ether',
        NATIVE_TOKEN_SYMBOL: 'ETH',
        NATIVE_TOKEN_DECIMALS: '18',
        BLOCK_EXPLORER_URL: 'http://localhost:3010',
        PRIVIDIUM_API_URL: 'http://localhost:8000',
        USER_PANEL_URL: 'http://localhost:3001',
        L1_CHAIN_ID: '31337',
        L1_CHAIN_NAME: 'Anvil Localhost',
        AUTH_METHODS: 'oidc',
        OIDC_JWKS_URI: 'http://localhost/jwks',
        OIDC_JWT_ISSUER: 'http://localhost/issuer',
        OIDC_JWT_AUD: 'test-aud',
        SIWE_CHAIN_ID: '1',
        SIWE_VALID_DOMAINS: 'localhost',
        SIWE_HMAC_SECRET: 'aaaaaaaa00000000aaaaaaaa00000000aaaaaaaa00000000aaaaaaaa00000000',
        WEBAUTHN_RP_NAME: 'test',
        WEBAUTHN_RP_ID: 'localhost',
        WEBAUTHN_ORIGIN: 'http://localhost:3000',
        WEBAUTHN_REQUIRE_USER_VERIFICATION: 'false',
        ADMIN_PANEL_REDIRECT_URLS: 'http://localhost:3000/callback',
        BLOCK_EXPLORER_REDIRECT_URLS: 'http://localhost:3001/callback',
        WALLETS_API_ENABLED: 'false',
        FAUCET_ENABLED: 'false',
        BUNDLER_ENABLED: 'false',
        THE_GRAPH_API_ENABLED: 'false',
        SENTRY_DSN: ''
    };

    function stubEnv(overrides: Record<string, string>) {
        for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
            vi.stubEnv(key, value);
        }
    }

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('rejects when USER_IDLE_TIMEOUT_SECONDS strictly exceeds USER_SESSION_DURATION_SECONDS', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600', USER_IDLE_TIMEOUT_SECONDS: '7200' });
        expect(() => loadEnv()).toThrow();
    });

    it('accepts when USER_IDLE_TIMEOUT_SECONDS is below the cap', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600', USER_IDLE_TIMEOUT_SECONDS: '600' });
        expect(() => loadEnv()).not.toThrow();
    });

    it('accepts when USER_IDLE_TIMEOUT_SECONDS equals the cap (degenerate fixed-expiry)', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600', USER_IDLE_TIMEOUT_SECONDS: '3600' });
        expect(() => loadEnv()).not.toThrow();
    });

    it('accepts when USER_IDLE_TIMEOUT_SECONDS is unset (feature OFF)', () => {
        stubEnv({ USER_SESSION_DURATION_SECONDS: '3600' });
        expect(() => loadEnv()).not.toThrow();
    });
});
