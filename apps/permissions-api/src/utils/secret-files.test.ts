import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readSecretFiles } from './secret-files';

describe('readSecretFiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-files-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function secretFile(name: string, contents: string): string {
        const path = join(dir, name);
        writeFileSync(path, contents);
        return path;
    }

    it('reads the value from the file, trimming the trailing newline', () => {
        const env = readSecretFiles({ TOKEN_FILE: secretFile('token', 'mounted-secret\n') }, ['TOKEN']);
        expect(env.TOKEN).toBe('mounted-secret');
    });

    it('trims a CRLF line ending', () => {
        const env = readSecretFiles({ TOKEN_FILE: secretFile('token-crlf', 'mounted-secret\r\n') }, ['TOKEN']);
        expect(env.TOKEN).toBe('mounted-secret');
    });

    it('leaves a variable without a _FILE form untouched', () => {
        expect(readSecretFiles({ TOKEN: 'inline' }, ['TOKEN'])).toEqual({ TOKEN: 'inline' });
    });

    it('treats an empty value beside a _FILE as unset', () => {
        const env = readSecretFiles({ TOKEN: '', TOKEN_FILE: secretFile('token-empty-inline', 'from-file') }, [
            'TOKEN'
        ]);
        expect(env.TOKEN).toBe('from-file');
    });

    it('refuses both forms at once', () => {
        const run = () => readSecretFiles({ TOKEN: 'inline', TOKEN_FILE: secretFile('both', 'from-file') }, ['TOKEN']);
        expect(run).toThrow('TOKEN and TOKEN_FILE are both set');
    });

    it('names the variable, not the path, when the file cannot be read', () => {
        const run = () => readSecretFiles({ TOKEN_FILE: join(dir, 'missing') }, ['TOKEN']);
        expect(run).toThrow('Cannot read TOKEN_FILE (ENOENT)');
    });

    it('refuses an empty file', () => {
        const run = () => readSecretFiles({ TOKEN_FILE: secretFile('empty', '\n') }, ['TOKEN']);
        expect(run).toThrow('TOKEN_FILE points at an empty file');
    });

    it('ignores a _FILE for a name it was not asked to resolve', () => {
        const env = readSecretFiles({ OTHER_FILE: secretFile('other', 'x') }, ['TOKEN']);
        expect(env.OTHER).toBeUndefined();
    });
});
