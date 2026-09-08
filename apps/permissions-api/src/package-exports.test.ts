import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exports = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).exports as Record<
    string,
    string
>;

describe('package exports', () => {
    it.each(Object.entries(exports))('%s resolves to a file that exists', (_subpath, target) => {
        expect(existsSync(resolve(packageRoot, target))).toBe(true);
    });
});
