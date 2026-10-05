import { describe, expect, it } from 'vitest';
import { connectionFromUrl, databaseUrlCarriesPassword, poolConfigFromUrl } from './credentials';

const token = async () => 'a-token';

describe('connectionFromUrl', () => {
    it('hands pg the URL and nothing else', async () => {
        const connection = connectionFromUrl('postgres://app:secret@db:5432/app');
        expect(connection.poolConfig).toEqual({ connectionString: 'postgres://app:secret@db:5432/app' });
        await connection.close();
    });
});

describe('poolConfigFromUrl', () => {
    it('carries host, port, database and user across, and never a connectionString', () => {
        const config = poolConfigFromUrl('postgres://prividium@db.example.internal:5432/prividium', token);
        expect(config).toMatchObject({
            host: 'db.example.internal',
            port: 5432,
            database: 'prividium',
            user: 'prividium'
        });
        // pg lays a parsed connectionString over the config, which would replace the callback.
        expect(config.connectionString).toBeUndefined();
    });

    it("puts the callback where the password goes, dropping the URL's own", () => {
        expect(poolConfigFromUrl('postgres://identity:stale@host:5432/db', token).password).toBe(token);
    });

    it('maps sslmode as pg does, and leaves ssl unset when the URL names none', () => {
        expect(poolConfigFromUrl('postgres://identity@host:5432/db?sslmode=verify-full', token).ssl).toEqual({});
        expect(poolConfigFromUrl('postgres://identity@host:5432/db?sslmode=disable', token).ssl).toBe(false);
        expect(poolConfigFromUrl('postgres://identity@host:5432/db', token)).not.toHaveProperty('ssl');
    });
});

describe('databaseUrlCarriesPassword', () => {
    it.each([
        ['userinfo', 'postgres://app:secret@db:5432/app'],
        ['the query string', 'postgres://app@db:5432/app?password=secret']
    ])('finds a password in %s', (_where, url) => {
        expect(databaseUrlCarriesPassword(url)).toBe(true);
    });

    it('finds none in a URL that names only the user', () => {
        expect(databaseUrlCarriesPassword('postgres://app@db:5432/app?sslmode=verify-full')).toBe(false);
    });

    it('counts a URL it cannot parse as carrying one', () => {
        expect(databaseUrlCarriesPassword('postgres://app@db:5432/app?sslrootcert=/nonexistent/ca.pem')).toBe(true);
    });
});
