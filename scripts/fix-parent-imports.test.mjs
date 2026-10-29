import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXER = path.join(HERE, 'fix-parent-imports.mjs');
const TYPESCRIPT = path.dirname(
    createRequire(path.join(HERE, '../apps/permissions-api/package.json')).resolve('typescript/package.json')
);

const REPOSITORY = {
    '.gitignore': 'node_modules\n',
    'pkg/package.json': JSON.stringify({ type: 'module', imports: { '#test/*': './test/*.ts', '#*': './src/*.ts' } }),
    'pkg/src/x.ts': 'export const x = 1;\n',
    'pkg/src/data.json': '{}\n',
    'pkg/src/dir/index.ts': 'export const dir = 1;\n',
    'pkg/src/dir/z.ts': 'export const z = 1;\n',
    'pkg/test/helper.ts': "import { x } from '../src/x';\nexport const helper = x;\n",
    'other/package.json': JSON.stringify({ type: 'module' }),
    'other/src/a/b.ts': "import { c } from '../c';\n",
    'other/src/c.ts': 'export const c = 1;\n'
};

let repo;

function setUp(files = {}) {
    repo = mkdtempSync(path.join(tmpdir(), 'fix-parent-imports-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    for (const [file, text] of Object.entries({ ...REPOSITORY, ...files })) {
        mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        writeFileSync(path.join(repo, file), text);
    }
    mkdirSync(path.join(repo, 'pkg/node_modules'));
    symlinkSync(TYPESCRIPT, path.join(repo, 'pkg/node_modules/typescript'));
}

function fix(...paths) {
    const { status, stdout, stderr } = spawnSync(process.execPath, [FIXER, ...paths], { cwd: repo, encoding: 'utf8' });
    expect(status, stderr).toBe(0);
    return { stdout, stderr };
}

function read(file) {
    return readFileSync(path.join(repo, file), 'utf8');
}

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('fix-parent-imports', () => {
    it('rewrites every kind of import from a parent folder to its # path', () => {
        setUp({
            'pkg/src/dir/sub/deep.ts': [
                "import { x } from '../../x';",
                "import { dir } from '..';",
                "export * from '../../x';",
                "export const lazy = () => import('../z');",
                "export type Z = typeof import('../z');",
                "import { helper } from '../../../test/helper';",
                ''
            ].join('\n')
        });

        fix();

        expect(read('pkg/src/dir/sub/deep.ts')).toBe(
            [
                "import { x } from '#x';",
                "import { dir } from '#dir/index';",
                "export * from '#x';",
                "export const lazy = () => import('#dir/z');",
                "export type Z = typeof import('#dir/z');",
                "import { helper } from '#test/helper';",
                ''
            ].join('\n')
        );
        expect(read('pkg/test/helper.ts')).toBe("import { x } from '#x';\nexport const helper = x;\n");
    });

    it('keeps a module of the same folder as a ./ import', () => {
        setUp({ 'pkg/src/dir/self.ts': "import { z } from '../dir/z';\n" });

        fix();

        expect(read('pkg/src/dir/self.ts')).toBe("import { z } from './z';\n");
    });

    it('leaves comments, strings and targets without a # path, and names those targets', () => {
        const source = ["// '../x'", 'const text = "\'../x\'";', "import data from '../data.json';", ''].join('\n');
        setUp({ 'pkg/src/dir/other.ts': source });

        const { stderr } = fix();

        expect(read('pkg/src/dir/other.ts')).toBe(source);
        expect(stderr).toContain("pkg/src/dir/other.ts: no # path for '../data.json'");
    });

    it('touches only the paths it is given, and only packages with # paths', () => {
        setUp({ 'pkg/src/dir/a.ts': "import { x } from '../x';\n", 'pkg/src/dir/b.ts': "import { x } from '../x';\n" });

        fix('pkg/src/dir/a.ts');

        expect(read('pkg/src/dir/a.ts')).toBe("import { x } from '#x';\n");
        expect(read('pkg/src/dir/b.ts')).toBe("import { x } from '../x';\n");
        expect(read('other/src/a/b.ts')).toBe("import { c } from '../c';\n");
    });

    it('changes nothing on a second run', () => {
        setUp({ 'pkg/src/dir/a.ts': "import { x } from '../x';\n" });
        fix();

        const { stdout } = fix();

        expect(stdout).toBe('');
        expect(read('pkg/src/dir/a.ts')).toBe("import { x } from '#x';\n");
    });
});
