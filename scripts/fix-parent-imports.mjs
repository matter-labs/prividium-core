import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const scopes = process.argv.slice(2).map((arg) => path.resolve(arg));

function listFiles(pathspec) {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', pathspec], {
        cwd: root,
        encoding: 'utf8'
    })
        .split('\0')
        .filter(Boolean)
        .map((file) => path.join(root, file))
        .filter((file) => existsSync(file));
}

function inScope(file) {
    return scopes.length === 0 || scopes.some((scope) => file === scope || file.startsWith(scope + path.sep));
}

// A package opts in by mapping `#…*` to `./…*.ts` in the `imports` of its package.json.
function subpathMappings(packageJson) {
    let imports;
    try {
        ({ imports = {} } = JSON.parse(readFileSync(packageJson, 'utf8')));
    } catch {
        return [];
    }
    return Object.entries(imports)
        .filter(([key, target]) => key.endsWith('*') && typeof target === 'string')
        .filter(([, target]) => target.startsWith('./') && target.endsWith('*.ts'))
        .map(([key, target]) => ({
            prefix: key.slice(0, -1),
            dir: path.join(path.dirname(packageJson), target.slice('./'.length, -'*.ts'.length))
        }));
}

function parentSpecifiers(ts, sourceFile) {
    const specifiers = [];
    const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
            specifiers.push(node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            specifiers.push(node.argument.literal);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            specifiers.push(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return specifiers.filter(
        (node) => node && ts.isStringLiteralLike(node) && (node.text === '..' || node.text.startsWith('../'))
    );
}

function rewrite(ts, specifier, file, mappings) {
    const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!target?.endsWith('.ts') || target.endsWith('.d.ts')) return undefined;
    const module = target.slice(0, -'.ts'.length);
    if (path.dirname(target) === path.dirname(file)) return `./${path.basename(module)}`;
    const mapping = mappings.find(({ dir }) => target.startsWith(dir));
    return mapping && mapping.prefix + path.relative(mapping.dir, module).split(path.sep).join('/');
}

const packages = listFiles(':(glob)**/package.json')
    .map((packageJson) => ({ dir: path.dirname(packageJson), mappings: subpathMappings(packageJson) }))
    .filter(({ mappings }) => mappings.length > 0);

for (const { dir, mappings } of packages) {
    let ts;
    for (const file of listFiles(path.relative(root, dir) || '.')) {
        if (!SOURCE_EXTENSIONS.has(path.extname(file)) || !inScope(file)) continue;
        const text = readFileSync(file, 'utf8');
        if (!text.includes("'..") && !text.includes('"..')) continue;
        // Each package is parsed with the TypeScript it compiles with; the repository root has none.
        ts ??= createRequire(path.join(dir, 'package.json'))('typescript');
        const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
        const edits = [];
        for (const literal of parentSpecifiers(ts, sourceFile)) {
            const replacement = rewrite(ts, literal.text, file, mappings);
            if (replacement) {
                edits.push({ start: literal.getStart(sourceFile) + 1, end: literal.end - 1, replacement });
            } else {
                console.warn(`${path.relative(root, file)}: no # path for '${literal.text}'`);
            }
        }
        if (edits.length === 0) continue;
        writeFileSync(
            file,
            edits.reduceRight((out, edit) => out.slice(0, edit.start) + edit.replacement + out.slice(edit.end), text)
        );
        console.log(`${path.relative(root, file)}: rewrote ${edits.length} ../ import(s)`);
    }
}
