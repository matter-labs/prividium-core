import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST_DIR = join(PKG_ROOT, 'dist/sdk');
const SKIP = !existsSync(DIST_DIR);

interface PackEntry {
    path: string;
    size: number;
    mode: number;
}

interface PackEntries {
    files: PackEntry[];
}

// When the test suite is run without a prior `pnpm build`, the entire describe block is
// skipped — silent skip would let a leak ship if CI never builds before testing. Print a
// loud warning so a future maintainer notices.
if (SKIP) {
    console.warn(
        '[pack-shape.test] skipping: dist/sdk does not exist. Run `pnpm build` first to enforce the publish-shape contract.'
    );
}

// Inspects what `npm pack` would publish: the file list, package.json metadata, and
// the contents of the entry-point .d.ts. This is the source-of-truth check that the
// publish-shape guard reflects reality; if any of these change unexpectedly, ship is broken.
describe.skipIf(SKIP)('npm pack publish shape', { timeout: 30_000 }, () => {
    it('does not include @repo/api-types in dependencies / peerDependencies', () => {
        const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
        };
        expect(pkg.dependencies?.['@repo/api-types']).toBeUndefined();
        expect(pkg.peerDependencies?.['@repo/api-types']).toBeUndefined();
        expect(pkg.optionalDependencies?.['@repo/api-types']).toBeUndefined();
    });

    it('emits entry-point .d.ts files matching the published exports map', () => {
        const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
            exports: Record<string, { types?: string; import?: string }>;
        };
        const mainTypes = pkg.exports['.']?.types;
        const siweTypes = pkg.exports['./siwe']?.types;
        expect(mainTypes).toBeDefined();
        expect(siweTypes).toBeDefined();
        expect(existsSync(join(PKG_ROOT, mainTypes ?? ''))).toBe(true);
        expect(existsSync(join(PKG_ROOT, siweTypes ?? ''))).toBe(true);
    });

    it('the packed tarball does not contain @repo/api-types references in any .d.ts or .js', () => {
        const json = execSync('npm pack --dry-run --json', { cwd: PKG_ROOT, encoding: 'utf8' });
        const [entry] = JSON.parse(json) as PackEntries[];
        expect(entry).toBeDefined();

        const distFiles = entry?.files.filter(
            (f) => f.path.startsWith('dist/') && (f.path.endsWith('.d.ts') || f.path.endsWith('.js'))
        );
        expect(distFiles?.length).toBeGreaterThan(0);

        for (const file of distFiles ?? []) {
            const fullPath = join(PKG_ROOT, file.path);
            if (!existsSync(fullPath)) continue;
            const content = readFileSync(fullPath, 'utf8');
            expect(
                content.includes('@repo/api-types'),
                `${file.path} should not reference '@repo/api-types' — found a leak`
            ).toBe(false);
        }
    });

    it('siwe.d.ts re-exports the curated admin namespace types', () => {
        const siweDts = readFileSync(join(PKG_ROOT, 'dist/sdk/siwe.d.ts'), 'utf8');
        for (const name of ['AdminUser', 'AdminUserUpdate', 'AdminContract', 'AdminContractCreate']) {
            expect(siweDts).toMatch(new RegExp(`\\bexport\\b[^;]*\\b${name}\\b`));
        }
    });

    it('siwe.d.ts and index.d.ts both export verifyUserAccessToken', () => {
        const indexDts = readFileSync(join(PKG_ROOT, 'dist/sdk/index.d.ts'), 'utf8');
        const siweDts = readFileSync(join(PKG_ROOT, 'dist/sdk/siwe.d.ts'), 'utf8');
        expect(indexDts).toMatch(/\bexport\b[^;]*\bverifyUserAccessToken\b/);
        expect(siweDts).toMatch(/\bexport\b[^;]*\bverifyUserAccessToken\b/);
    });
});
