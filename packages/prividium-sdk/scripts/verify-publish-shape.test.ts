import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPublishShape } from './verify-publish-shape.js';

interface Fixture {
    root: string;
    cleanup: () => void;
}

function makeFixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'publish-shape-'));
    return {
        root,
        cleanup: () => rmSync(root, { recursive: true, force: true })
    };
}

function writeCleanFixture(root: string): void {
    mkdirSync(join(root, 'dist/sdk'), { recursive: true });
    const pkg = {
        name: '@repo/prividium-sdk',
        dependencies: { zod: '^4.0.0' },
        devDependencies: { '@repo/api-types': 'workspace:*' }
    };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
    writeFileSync(
        join(root, 'dist/sdk/index.d.ts'),
        `export declare function verifyUserAccessToken(token: string, opts: { apiUrl: string }): Promise<unknown>;\n`
    );
    writeFileSync(
        join(root, 'dist/sdk/siwe.d.ts'),
        [
            'export declare function createPrividiumSiweChain(config: unknown): unknown;',
            'export declare function verifyUserAccessToken(token: string, opts: { apiUrl: string }): Promise<unknown>;',
            'export interface AdminUser { id: string }',
            'export interface AdminUserUpdate { wallets?: string[] }',
            'export interface AdminContract { contractAddress: string }',
            'export interface AdminContractCreate { contractAddress: string }'
        ].join('\n')
    );
    writeFileSync(join(root, 'dist/sdk/index.js'), 'export function verifyUserAccessToken() {}\n');
    writeFileSync(join(root, 'dist/sdk/siwe.js'), 'export function createPrividiumSiweChain() {}\n');
}

const defaultOpts = (root: string) => ({
    root,
    distRelDir: 'dist/sdk',
    pkgJsonRel: 'package.json',
    entries: [
        { path: 'dist/sdk/index.d.ts', requiredExports: ['verifyUserAccessToken'] },
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
});

describe('verifyPublishShape', () => {
    let fixture: Fixture;

    beforeEach(() => {
        fixture = makeFixture();
    });

    afterEach(() => {
        fixture.cleanup();
    });

    it('returns no violations for a clean dist', () => {
        writeCleanFixture(fixture.root);
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toEqual([]);
    });

    it('catches @repo/api-types reference in entry .d.ts', () => {
        writeCleanFixture(fixture.root);
        writeFileSync(
            join(fixture.root, 'dist/sdk/index.d.ts'),
            "import type { Foo } from '@repo/api-types/permissions-api';\n" +
                'export declare function verifyUserAccessToken(): Promise<Foo>;\n'
        );
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toContain("dist/sdk/index.d.ts contains '@repo/api-types'");
    });

    it('catches @repo/api-types reference in a nested .d.ts', () => {
        writeCleanFixture(fixture.root);
        mkdirSync(join(fixture.root, 'dist/sdk/admin-api'), { recursive: true });
        writeFileSync(
            join(fixture.root, 'dist/sdk/admin-api/types.d.ts'),
            "export type X = import('@repo/api-types').Foo;\n"
        );
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toContain("dist/sdk/admin-api/types.d.ts contains '@repo/api-types'");
    });

    it('catches @repo/api-types reference in a .js file', () => {
        writeCleanFixture(fixture.root);
        writeFileSync(
            join(fixture.root, 'dist/sdk/index.js'),
            "import '@repo/api-types/permissions-api';\nexport function verifyUserAccessToken() {}\n"
        );
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toContain("dist/sdk/index.js contains '@repo/api-types'");
    });

    it('catches @repo/api-types listed in dependencies', () => {
        writeCleanFixture(fixture.root);
        writeFileSync(
            join(fixture.root, 'package.json'),
            JSON.stringify({
                name: '@repo/prividium-sdk',
                dependencies: { '@repo/api-types': 'workspace:*', zod: '^4.0.0' }
            })
        );
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toContain(
            "package.json#dependencies lists '@repo/api-types' (must be devDependencies-only)"
        );
    });

    it('catches @repo/api-types listed in peerDependencies', () => {
        writeCleanFixture(fixture.root);
        writeFileSync(
            join(fixture.root, 'package.json'),
            JSON.stringify({
                name: '@repo/prividium-sdk',
                peerDependencies: { '@repo/api-types': 'workspace:*' }
            })
        );
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toContain(
            "package.json#peerDependencies lists '@repo/api-types' (must be devDependencies-only)"
        );
    });

    it('catches a missing required export in siwe.d.ts', () => {
        writeCleanFixture(fixture.root);
        writeFileSync(
            join(fixture.root, 'dist/sdk/siwe.d.ts'),
            'export declare function createPrividiumSiweChain(config: unknown): unknown;\n' +
                'export declare function verifyUserAccessToken(): unknown;\n'
            // intentionally missing AdminUser, AdminUserUpdate, AdminContract, AdminContractCreate
        );
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations).toContain("dist/sdk/siwe.d.ts is missing required export 'AdminUser'");
        expect(violations).toContain("dist/sdk/siwe.d.ts is missing required export 'AdminUserUpdate'");
        expect(violations).toContain("dist/sdk/siwe.d.ts is missing required export 'AdminContract'");
        expect(violations).toContain("dist/sdk/siwe.d.ts is missing required export 'AdminContractCreate'");
    });

    it('reports when dist directory is missing', () => {
        // package.json present, but dist/ never created → guard should call this out
        writeFileSync(join(fixture.root, 'package.json'), JSON.stringify({ name: '@repo/prividium-sdk' }));
        const violations = verifyPublishShape(defaultOpts(fixture.root));
        expect(violations[0]).toMatch(/dist directory 'dist\/sdk' is missing/);
    });
});
