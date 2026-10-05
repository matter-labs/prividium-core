import {
    connectionFromUrl,
    type DatabaseConnection,
    type DatabaseCredentials,
    PASSWORD_DATABASE_AUTH
} from '@repo/api-kit';

/**
 * Resolves `DATABASE_AUTH` into the pool's connection: `password` is the URL's own, any other mode is the
 * host-supplied provider that claims it. Awaited at boot, so a provider that cannot authenticate fails there.
 */
export async function resolveDatabaseConnection(
    mode: string,
    target: { databaseUrl: string; connectionTimeoutMs: number },
    credentials: DatabaseCredentials | undefined
): Promise<DatabaseConnection> {
    if (credentials?.mode === PASSWORD_DATABASE_AUTH) {
        throw new Error(
            `A credential provider claims DATABASE_AUTH=${PASSWORD_DATABASE_AUTH}, which always means the password in DATABASE_URL`
        );
    }
    if (mode === PASSWORD_DATABASE_AUTH) {
        return connectionFromUrl(target.databaseUrl);
    }
    if (credentials?.mode !== mode) {
        const supported = [PASSWORD_DATABASE_AUTH, ...(credentials ? [credentials.mode] : [])].join(', ');
        throw new Error(
            `DATABASE_AUTH=${mode} is not a mode this build supports: no credential provider claims it (supported: ${supported})`
        );
    }
    return credentials.connect(target);
}
