import { describe, expect, it } from 'vitest';
import z from 'zod/v4';
import { customLogger, scrubConnectionStrings } from './logger';

describe('Logger', () => {
    it('should log with correct format: level as tag and "message" key for content', () => {
        const chunks: string[] = [];
        const stream = {
            write: (chunk: string) => {
                chunks.push(chunk);
                return true;
            }
        };

        const testLogger = customLogger({ level: 'trace' }, stream);
        testLogger.info('test log message');
        testLogger.error('test error message');
        testLogger.warn('test warn message');
        testLogger.debug('test debug message');
        testLogger.trace('test trace message');

        // Verify correct format: level as tag and "message" key for content
        const logEntries = z
            .object({ level: z.string(), message: z.string() })
            .array()
            .safeParse(chunks.map((c) => JSON.parse(c)));

        expect(logEntries.data?.length).toBe(5);
        expect(logEntries.success).toBe(true);

        expect(logEntries.data?.[0]?.level).toBe('info');
        expect(logEntries.data?.[0]?.message).toBe('test log message');

        expect(logEntries.data?.[1]?.level).toBe('error');
        expect(logEntries.data?.[1]?.message).toBe('test error message');

        expect(logEntries.data?.[2]?.level).toBe('warn');
        expect(logEntries.data?.[2]?.message).toBe('test warn message');

        expect(logEntries.data?.[3]?.level).toBe('debug');
        expect(logEntries.data?.[3]?.message).toBe('test debug message');

        expect(logEntries.data?.[4]?.level).toBe('trace');
        expect(logEntries.data?.[4]?.message).toBe('test trace message');
    });

    it('redacts wallet token from url field', () => {
        const chunks: string[] = [];
        const stream = {
            write: (chunk: string) => {
                chunks.push(chunk);
                return true;
            }
        };

        const testLogger = customLogger({ level: 'info' }, stream);
        testLogger.info({ url: '/rpc/wallet/SECRET_TOKEN' }, 'test');

        expect(chunks).toHaveLength(1);
        const logEntry = JSON.parse(chunks[0] as string);
        expect(logEntry.url).toBe('/rpc/wallet/[REDACTED]');
        expect(chunks[0]).not.toContain('SECRET_TOKEN');
    });

    it('does not redact non-wallet URLs', () => {
        const chunks: string[] = [];
        const stream = {
            write: (chunk: string) => {
                chunks.push(chunk);
                return true;
            }
        };

        const testLogger = customLogger({ level: 'info' }, stream);
        testLogger.info({ url: '/api/users' }, 'test');

        expect(chunks).toHaveLength(1);
        const logEntry = JSON.parse(chunks[0] as string);
        expect(logEntry.url).toBe('/api/users');
    });

    it('handles non-string url values', () => {
        const chunks: string[] = [];
        const stream = {
            write: (chunk: string) => {
                chunks.push(chunk);
                return true;
            }
        };

        const testLogger = customLogger({ level: 'info' }, stream);
        testLogger.info({ url: 123 }, 'test');

        expect(chunks).toHaveLength(1);
        const logEntry = JSON.parse(chunks[0] as string);
        expect(logEntry.url).toBe(123);
    });
});

describe('Logger credential guards', () => {
    function capture() {
        const chunks: string[] = [];
        const stream = {
            write: (chunk: string) => {
                chunks.push(chunk);
                return true;
            }
        };
        return { logger: customLogger({ level: 'info' }, stream), chunks };
    }

    it('redacts credential headers, top level and one level down', () => {
        const { logger, chunks } = capture();
        const headers = {
            authorization: 'Bearer abc123',
            cookie: 'sid=abc123',
            'x-api-key': 'abc123',
            'user-agent': 'ua'
        };
        logger.info({ headers, req: { headers } }, 'request');

        const entry = JSON.parse(chunks[0] as string);
        for (const logged of [entry.headers, entry.req.headers]) {
            expect(logged).toEqual({
                authorization: '[REDACTED]',
                cookie: '[REDACTED]',
                'x-api-key': '[REDACTED]',
                'user-agent': 'ua'
            });
        }
        expect(chunks[0]).not.toContain('abc123');
    });

    it('redacts token, password and secret fields', () => {
        const { logger, chunks } = capture();
        logger.info(
            {
                token: 't0ken',
                session: { token: 't0ken', id: 7 },
                db: { password: 't0ken' },
                oidc: { secret: 't0ken' }
            },
            'fields'
        );

        const entry = JSON.parse(chunks[0] as string);
        expect(entry.token).toBe('[REDACTED]');
        expect(entry.session).toEqual({ token: '[REDACTED]', id: 7 });
        expect(entry.db.password).toBe('[REDACTED]');
        expect(entry.oidc.secret).toBe('[REDACTED]');
        expect(chunks[0]).not.toContain('t0ken');
    });

    it('scrubs a connection string from an error, its stack and the message taken from it', () => {
        const { logger, chunks } = capture();
        logger.child({ component: 'db' }).error(new Error('connect failed for postgres://app:hunter2@db:5432/app'));

        const entry = JSON.parse(chunks[0] as string);
        expect(chunks[0]).not.toContain('hunter2');
        expect(entry.message).toBe('connect failed for postgres://[REDACTED]@db:5432/app');
        expect(entry.err.message).toBe('connect failed for postgres://[REDACTED]@db:5432/app');
        expect(entry.err.stack).toContain('postgres://[REDACTED]@db:5432/app');
    });

    it('scrubs a connection string from any field and an explicit message', () => {
        const { logger, chunks } = capture();
        logger.info({ target: { url: 'postgres://app:pa"ss@db/app' } }, 'dialing postgres://app:hunter2@db/app');

        expect(chunks[0]).not.toContain('hunter2');
        expect(chunks[0]).not.toContain('pa\\"ss');
        const entry = JSON.parse(chunks[0] as string);
        expect(entry.message).toBe('dialing postgres://[REDACTED]@db/app');
        expect(entry.target.url).toBe('postgres://[REDACTED]@db/app');
    });

    it('scrubs passwords pg accepts with a raw @, spaces or a password query parameter', () => {
        const { logger, chunks } = capture();
        logger.info({
            at: 'postgres://app:p@ss@db/app',
            spaced: 'postgres://app:my secret@db/app',
            query: 'postgres://db/app?user=app&password=hunter2&sslmode=require'
        });

        expect(chunks[0]).not.toMatch(/p@ss|ss@db|my secret|hunter2/);
        const entry = JSON.parse(chunks[0] as string);
        expect(entry.at).toBe('postgres://[REDACTED]@db/app');
        expect(entry.spaced).toBe('postgres://[REDACTED]@db/app');
        expect(entry.query).toBe('postgres://db/app?user=app&password=[REDACTED]&sslmode=require');
    });

    it('stops the userinfo at the query or fragment, keeping the host', () => {
        const { logger, chunks } = capture();
        logger.info({ query: 'https://u:p@h?e=a@b', fragment: 'https://u:p@h#e=a@b' });

        const entry = JSON.parse(chunks[0] as string);
        expect(entry.query).toBe('https://[REDACTED]@h?e=a@b');
        expect(entry.fragment).toBe('https://[REDACTED]@h#e=a@b');
    });

    it('redacts free text up to an @ as userinfo, as pg would parse it', () => {
        expect(scrubConnectionStrings('http://localhost:8545 sent to bob@corp')).toBe('http://[REDACTED]@corp');
    });

    it('leaves URLs without a password untouched', () => {
        const line = 'postgres://app@db:5432/app https://example.com/a:b@c http://localhost:8545';
        expect(scrubConnectionStrings(line)).toBe(line);
    });
});
