import { type AddressInfo, createServer } from 'node:net';
import type { Pool } from 'pg';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbPool, poolState } from './client';
import { poolConfigFromUrl } from './credentials';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:notsecurepassword@localhost:5500/postgres';
const logger = { error: () => {} };

describe('createDbPool instrumentation', () => {
    const onQuery = vi.fn<(durationMs: number, outcome: 'ok' | 'error') => void>();
    let pool: Pool;

    beforeAll(async () => {
        pool = createDbPool(DATABASE_URL, logger, false, true, 10_000, 10_000, 2, 5_000, { onQuery });
        await pool.query('select 1');
        return () => pool.end();
    });

    beforeEach(() => {
        onQuery.mockClear();
    });

    it('reports one ok observation for a pool query', async () => {
        const result = await pool.query('select 1 as one');

        expect(result.rows).toEqual([{ one: 1 }]);
        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenCalledWith(expect.any(Number), 'ok');
    });

    it('reports one observation per query on a checked-out client', async () => {
        const client = await pool.connect();
        try {
            const result = await client.query('select 2 as two');
            expect(result.rows).toEqual([{ two: 2 }]);
        } finally {
            client.release();
        }

        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenCalledWith(expect.any(Number), 'ok');
    });

    it('wraps a reused client once', async () => {
        const first = await pool.connect();
        first.release();
        const second = await pool.connect();
        try {
            await second.query('select 3');
        } finally {
            second.release();
        }

        expect(onQuery).toHaveBeenCalledTimes(1);
    });

    it('reports error and rethrows the original error', async () => {
        await expect(pool.query('select * from does_not_exist_xyz')).rejects.toMatchObject({ code: '42P01' });

        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenCalledWith(expect.any(Number), 'error');
    });

    it('leaves the callback form unmeasured', async () => {
        await new Promise<void>((resolve, reject) => {
            pool.query('select 4', (err) => (err ? reject(err) : resolve()));
        });

        expect(onQuery).not.toHaveBeenCalled();
    });

    it('exposes pool counts', () => {
        const state = poolState(pool);

        expect(state.max).toBe(2);
        expect(state.total).toBeGreaterThanOrEqual(1);
        expect(state.active).toBe(state.total - state.idle);
        expect(state.waiting).toBe(0);
    });

    it('counts a checked-out client as active', async () => {
        const client = await pool.connect();
        try {
            expect(poolState(pool).active).toBeGreaterThanOrEqual(1);
        } finally {
            client.release();
        }
    });
});

describe('createDbPool with a resolved connection', () => {
    it("keeps the caller's sizing, acquire timeout and lifetime over the provider's config", async () => {
        const pool = createDbPool(
            {
                poolConfig: { host: 'db', max: 99, connectionTimeoutMillis: 1, maxLifetimeSeconds: 0 },
                close: async () => {}
            },
            logger,
            false,
            true,
            10_000,
            10_000,
            3,
            5_000,
            undefined,
            1800
        );
        try {
            expect(pool.options).toMatchObject({
                host: 'db',
                max: 3,
                connectionTimeoutMillis: 5_000,
                maxLifetimeSeconds: 1800
            });
        } finally {
            await pool.end();
        }
    });

    it("lets the URL's sslmode override DATABASE_ENABLE_SSL, as a connection string does, and only then", async () => {
        const withMode = createDbPool(
            {
                poolConfig: poolConfigFromUrl('postgres://app@db/app?sslmode=disable', async () => 't'),
                close: async () => {}
            },
            logger,
            true
        );
        const withoutMode = createDbPool(
            { poolConfig: poolConfigFromUrl('postgres://app@db/app', async () => 't'), close: async () => {} },
            logger,
            true
        );
        try {
            expect(withMode.options.ssl).toBe(false);
            expect(withoutMode.options.ssl).toBe(true);
        } finally {
            await withMode.end();
            await withoutMode.end();
        }
    });

    it('refuses a connection carrying both a connectionString and a password, which pg would lose', () => {
        const connection = {
            poolConfig: { connectionString: 'postgres://app@db/app', password: async () => 'token' },
            close: async () => {}
        };
        expect(() => createDbPool(connection, logger)).toThrow('may not set both connectionString and password');
    });

    // Stands in for a server that asks for a cleartext password, recording each one it is sent.
    async function passwordServer() {
        const received: string[] = [];
        const server = createServer((socket) => {
            socket.once('data', () => {
                socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3]));
                socket.once('data', (message: Buffer) => {
                    received.push(message.subarray(5, message.length - 1).toString());
                    socket.destroy();
                });
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        return { url: `postgres://app:static@127.0.0.1:${port}/app`, received, server };
    }

    it('sends the password in the URL when handed a bare URL', async () => {
        const { url, received, server } = await passwordServer();
        const pool = createDbPool(url, logger, false, true, 1_000, 1_000, 1, 1_000);
        try {
            await expect(pool.query('select 1')).rejects.toThrow();
            expect(received).toEqual(['static']);
        } finally {
            await pool.end();
            server.close();
        }
    });

    it('closes the socket when the password callback rejects', async () => {
        const closed: boolean[] = [];
        const server = createServer((socket) => {
            const index = closed.push(false) - 1;
            socket.on('close', () => {
                closed[index] = true;
            });
            socket.once('data', () => {
                socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3]));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        const connection = {
            poolConfig: poolConfigFromUrl(`postgres://app@127.0.0.1:${port}/app`, async () => {
                throw new Error('no token');
            }),
            close: async () => {}
        };
        const pool = createDbPool(connection, logger, false, true, 1_000, 1_000, 1, 1_000);
        try {
            await expect(pool.query('select 1')).rejects.toThrow('no token');
            await expect(pool.query('select 1')).rejects.toThrow('no token');
            await vi.waitFor(() => expect(closed).toEqual([true, true]));
        } finally {
            await pool.end();
            server.close();
        }
    });

    it('asks the password callback on every new connection, in place of the password in the URL', async () => {
        const { url, received, server } = await passwordServer();
        let issued = 0;
        const connection = {
            poolConfig: poolConfigFromUrl(url, async () => `token-${++issued}`),
            close: async () => {}
        };
        const pool = createDbPool(connection, logger, false, true, 1_000, 1_000, 1, 1_000);
        try {
            await expect(pool.query('select 1')).rejects.toThrow();
            await expect(pool.query('select 1')).rejects.toThrow();
            expect(received).toEqual(['token-1', 'token-2']);
        } finally {
            await pool.end();
            server.close();
        }
    });
});

// Against a real server, because this is what the passwordless modes rest on: pg authenticates from the callback,
// and a recycled connection asks it again, so a rotated credential takes effect within the lifetime.
const SERVER_PASSWORD = new URL(DATABASE_URL).password;

describe.skipIf(!SERVER_PASSWORD)('createDbPool connection lifetime', () => {
    it('recycles a connection past its lifetime and authenticates the next one from the callback again', async () => {
        const supplied: string[] = [];
        let credential = decodeURIComponent(SERVER_PASSWORD);
        const connection = {
            poolConfig: poolConfigFromUrl(DATABASE_URL, async () => {
                supplied.push(credential);
                return credential;
            }),
            close: async () => {}
        };
        const pool = createDbPool(connection, logger, false, true, 5_000, 5_000, 1, 5_000, undefined, 1);
        try {
            await expect(pool.query('select 1 as one')).resolves.toMatchObject({ rows: [{ one: 1 }] });
            expect(supplied).toHaveLength(1);

            credential = 'no-longer-the-credential';
            await new Promise((resolve) => setTimeout(resolve, 1_500));

            await expect(pool.query('select 1')).rejects.toThrow(/password authentication failed/);
            expect(supplied.at(-1)).toBe('no-longer-the-credential');
        } finally {
            await pool.end();
        }
    });
});
