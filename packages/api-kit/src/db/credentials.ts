import type { PoolConfig } from 'pg';
import { parse, parseIntoClientConfig } from 'pg-connection-string';

/** The `DATABASE_AUTH` mode that uses the URL's own password; every other mode is a provider's. */
export const PASSWORD_DATABASE_AUTH = 'password';

/**
 * One resolved way to reach the database. A pool config rather than a password, so a provider can supply a
 * connector or a client certificate too; `close` releases whatever the provider holds.
 */
export interface DatabaseConnection {
    readonly poolConfig: PoolConfig;
    close(): Promise<void>;
}

/**
 * Called once at boot, so a provider that cannot authenticate fails the boot, not the first query.
 * `connectionTimeoutMs` is the pool's acquire deadline, which also bounds a connect awaiting a password callback.
 */
export type CredentialProvider = (target: {
    databaseUrl: string;
    connectionTimeoutMs: number;
}) => Promise<DatabaseConnection>;

/** A host-supplied provider and the `DATABASE_AUTH` mode it claims. */
export type DatabaseCredentials = {
    readonly mode: string;
    readonly connect: CredentialProvider;
};

export function connectionFromUrl(databaseUrl: string): DatabaseConnection {
    return { poolConfig: { connectionString: databaseUrl }, close: async () => {} };
}

/**
 * The URL's fields with `password` in place of its password. Decomposed because pg lays a parsed
 * `connectionString` over the config, and the parse always carries a `password`, even an empty one.
 */
export function poolConfigFromUrl(databaseUrl: string, password: () => Promise<string>): PoolConfig {
    const { password: _fromUrl, ...target } = parseIntoClientConfig(databaseUrl);
    return { ...target, password };
}

/**
 * Whether pg would send a password taken from this URL, userinfo or `?password=`. An unparseable URL counts
 * as carrying one: the parse reads `sslcert` and friends from disk, so a failure leaves the answer unknown.
 */
export function databaseUrlCarriesPassword(databaseUrl: string): boolean {
    try {
        return Boolean(parse(databaseUrl).password);
    } catch {
        return true;
    }
}
