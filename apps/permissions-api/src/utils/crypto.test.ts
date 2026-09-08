import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptFromFile, encryptToFile } from './crypto';

describe('Crypto', () => {
    const testKey = Buffer.from('1By35elglzIeUaTYU0E6gD4bnZdhTUL5s7MgwUyomM4=', 'base64');
    const testContent = Buffer.from('test content to encrypt');
    const testFilePath = join(tmpdir(), `test-${Date.now()}.enc`);

    afterEach(() => {
        try {
            unlinkSync(testFilePath);
        } catch {
            // File might not exist
        }
    });

    describe('encryptToFile', () => {
        it('should encrypt content to file', () => {
            encryptToFile(testContent, testKey, testFilePath);

            const fileContent = readFileSync(testFilePath, 'utf-8');
            const parts = fileContent.split(':');

            expect(parts).toHaveLength(3);
            expect(parts[0]).toHaveLength(24); // IV hex length
            expect(parts[1]).toHaveLength(32); // Auth tag hex length
        });

        it('should create different encrypted output each time', () => {
            const filePath1 = `${testFilePath}.1`;
            const filePath2 = `${testFilePath}.2`;

            encryptToFile(testContent, testKey, filePath1);
            encryptToFile(testContent, testKey, filePath2);

            const content1 = readFileSync(filePath1, 'utf-8');
            const content2 = readFileSync(filePath2, 'utf-8');

            expect(content1).not.toBe(content2);
            unlinkSync(filePath1);
            unlinkSync(filePath2);
        });
    });

    describe('decryptFromFile', () => {
        it('should decrypt encrypted content correctly', () => {
            encryptToFile(testContent, testKey, testFilePath);
            const decrypted = decryptFromFile(testFilePath, testKey);

            expect(decrypted).toEqual(testContent);
        });

        it('should handle empty buffer', () => {
            const emptyContent = Buffer.from('');
            encryptToFile(emptyContent, testKey, testFilePath);
            const decrypted = decryptFromFile(testFilePath, testKey);

            expect(decrypted).toEqual(emptyContent);
        });

        it('should fail with wrong key', () => {
            encryptToFile(testContent, testKey, testFilePath);
            const wrongKey = Buffer.from('p9z1+1fosO6cwgy653pYeNzl9OpRQ/oY6HAd+tBD704=', 'base64');

            expect(() => decryptFromFile(testFilePath, wrongKey)).toThrow();
        });

        it('should throw on invalid file format', () => {
            const badFilePath = `${testFilePath}.bad`;
            writeFileSync(badFilePath, 'invalid:format');
            expect(() => decryptFromFile(badFilePath, testKey)).toThrow('wrong message format');
            unlinkSync(badFilePath);
        });
    });
});
