/**
 * Publish-shape guard for @repo/prividium-sdk.
 *
 * Runs after `pnpm build` (wired into `prepublishOnly`) and asserts that:
 *   (a) No file in `dist/sdk/` references the workspace-only `@repo/api-types` package
 *       (which is in devDependencies only and would be unresolvable for external consumers).
 *   (b) package.json does not list `@repo/api-types` as a runtime dependency.
 *   (c) The two entry-point .d.ts files export the curated admin types.
 *
 * Exits 1 on any violation, printing a list. Intended for the SDK package only — but
 * accepts an optional `--root <dir>` argument so the unit test can point it at a fixture.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_PACKAGE = '@repo/api-types';

interface VerifyOptions {
    root: string;
    distRelDir: string;
    pkgJsonRel: string;
    entries: Array<{
        path: string;
        requiredExports: string[];
    }>;
}

const DEFAULT_OPTIONS: Omit<VerifyOptions, 'root'> = {
    distRelDir: 'dist/sdk',
    pkgJsonRel: 'package.json',
    entries: [
        {
            path: 'dist/sdk/index.d.ts',
            requiredExports: ['verifyUserAccessToken']
        },
        {
            path: 'dist/sdk/siwe.d.ts',
            requiredExports: [
                'verifyUserAccessToken',
                'AdminUser',
                'AdminUserUpdate',
                'AdminContract',
                'AdminContractCreate',
                'createPrividiumSiweChain'
            ]
        }
    ]
};

function* walk(dir: string, exts: ReadonlyArray<string>): Generator<string> {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(fullPath, exts);
        } else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
            yield fullPath;
        }
    }
}

export function verifyPublishShape(opts: VerifyOptions): string[] {
    const violations: string[] = [];

    const distDir = join(opts.root, opts.distRelDir);
    if (!existsSync(distDir)) {
        violations.push(`dist directory '${opts.distRelDir}' is missing; did you run 'pnpm build' before this script?`);
        return violations;
    }

    for (const file of walk(distDir, ['.js', '.d.ts', '.mjs', '.cjs'])) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(FORBIDDEN_PACKAGE)) {
            violations.push(`${file.replace(`${opts.root}/`, '')} contains '${FORBIDDEN_PACKAGE}'`);
        }
    }

    const pkgPath = join(opts.root, opts.pkgJsonRel);
    if (!existsSync(pkgPath)) {
        violations.push(`${opts.pkgJsonRel} not found at ${pkgPath}`);
    } else {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, Record<string, string> | unknown>;
        for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
            const block = pkg[field];
            if (block && typeof block === 'object' && FORBIDDEN_PACKAGE in (block as Record<string, string>)) {
                violations.push(`package.json#${field} lists '${FORBIDDEN_PACKAGE}' (must be devDependencies-only)`);
            }
        }
    }

    for (const entry of opts.entries) {
        const entryPath = join(opts.root, entry.path);
        if (!existsSync(entryPath)) {
            violations.push(`entry-point declaration '${entry.path}' is missing`);
            continue;
        }
        const content = readFileSync(entryPath, 'utf8');
        for (const exportName of entry.requiredExports) {
            const pattern = new RegExp(`\\bexport\\b[^;]*\\b${exportName}\\b`);
            if (!pattern.test(content)) {
                violations.push(`${entry.path} is missing required export '${exportName}'`);
            }
        }
    }

    return violations;
}

function parseArgs(argv: ReadonlyArray<string>): { root: string } {
    let root = process.cwd();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--root' && i + 1 < argv.length) {
            const next = argv[i + 1];
            if (typeof next === 'string') {
                root = next;
                i += 1;
            }
        }
    }
    return { root };
}

function main(): void {
    const { root } = parseArgs(process.argv.slice(2));
    const violations = verifyPublishShape({ ...DEFAULT_OPTIONS, root });

    if (violations.length === 0) {
        console.log(`✓ verify-publish-shape: dist/sdk is clean (no '${FORBIDDEN_PACKAGE}' leaks)`);
        return;
    }

    console.error('verify-publish-shape: violations found:');
    for (const v of violations) {
        console.error(`  - ${v}`);
    }
    process.exit(1);
}

// Run only when invoked directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
