import { describe, expect, it } from 'vitest';
import z from 'zod/v4';
import { customLogger } from './logger';

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
