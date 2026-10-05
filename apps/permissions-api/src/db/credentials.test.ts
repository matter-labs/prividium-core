import type { DatabaseCredentials } from '@repo/api-kit';
import { describe, expect, it, vi } from 'vitest';
import { resolveDatabaseConnection } from './credentials';

const WITH_PASSWORD = { databaseUrl: 'postgres://app:secret@db:5432/app', connectionTimeoutMs: 5_000 };
const WITHOUT_PASSWORD = { databaseUrl: 'postgres://app@db:5432/app', connectionTimeoutMs: 5_000 };

function provider(mode: string): DatabaseCredentials & { connect: ReturnType<typeof vi.fn> } {
    return {
        mode,
        connect: vi.fn(async () => ({ poolConfig: { host: 'from-provider' }, close: async () => {} }))
    };
}

describe('resolveDatabaseConnection', () => {
    it("uses the URL's own password under password auth, even beside a supplied provider", async () => {
        const credentials = provider('token-mode');

        const connection = await resolveDatabaseConnection('password', WITH_PASSWORD, credentials);

        expect(connection.poolConfig).toEqual({ connectionString: WITH_PASSWORD.databaseUrl });
        expect(credentials.connect).not.toHaveBeenCalled();
    });

    it('awaits the provider that claims the mode, handing it the URL and the acquire deadline', async () => {
        const credentials = provider('token-mode');

        const connection = await resolveDatabaseConnection('token-mode', WITHOUT_PASSWORD, credentials);

        expect(credentials.connect).toHaveBeenCalledWith(WITHOUT_PASSWORD);
        expect(connection.poolConfig).toEqual({ host: 'from-provider' });
    });

    it("surfaces the provider's own failure", async () => {
        const credentials: DatabaseCredentials = {
            mode: 'token-mode',
            connect: async () => {
                throw new Error('the identity could not authenticate');
            }
        };

        await expect(resolveDatabaseConnection('token-mode', WITHOUT_PASSWORD, credentials)).rejects.toThrow(
            'the identity could not authenticate'
        );
    });

    it('refuses a mode when no provider was supplied, naming it', async () => {
        await expect(resolveDatabaseConnection('iam-token', WITHOUT_PASSWORD, undefined)).rejects.toThrow(
            'DATABASE_AUTH=iam-token is not a mode this build supports: no credential provider claims it (supported: password)'
        );
    });

    it('refuses a mode the supplied provider does not claim', async () => {
        const credentials = provider('token-mode');

        await expect(resolveDatabaseConnection('iam-token', WITHOUT_PASSWORD, credentials)).rejects.toThrow(
            '(supported: password, token-mode)'
        );
        expect(credentials.connect).not.toHaveBeenCalled();
    });

    it('refuses a provider that claims password', async () => {
        await expect(resolveDatabaseConnection('password', WITH_PASSWORD, provider('password'))).rejects.toThrow(
            'A credential provider claims DATABASE_AUTH=password'
        );
    });
});
