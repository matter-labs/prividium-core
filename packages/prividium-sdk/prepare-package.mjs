import { promises as fs } from 'node:fs';
import path from 'node:path';

const version = process.env.INPUT_VERSION;
if (!version) {
    console.error('Error: INPUT_VERSION is required.');
    process.exit(1);
}

const packageJsonPath = path.resolve('./package.json');
const distDir = path.resolve('./dist');

// Walk `dist` and refuse to publish if any compiled file still references the
// workspace alias `@repo/prividium-sdk`. The published package is renamed to
// `prividium`, so any surviving `@repo/...` import would resolve to nothing on
// the consumer side and crash `npx prividium` with ERR_MODULE_NOT_FOUND. Use
// `#sdk` / `#sdk/siwe` subpath imports in CLI source instead.
async function assertNoWorkspaceImportsInDist() {
    const offenders = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && /\.(js|mjs|cjs|d\.ts)$/.test(entry.name)) {
                const content = await fs.readFile(full, 'utf8');
                if (content.includes('@repo/prividium-sdk')) {
                    offenders.push(path.relative(distDir, full));
                }
            }
        }
    }
    await walk(distDir);
    if (offenders.length > 0) {
        console.error(
            'Refusing to publish: the following dist files still import `@repo/prividium-sdk`. ' +
                'Replace those imports with `#sdk` / `#sdk/siwe` subpath imports:'
        );
        for (const o of offenders) console.error(`  - dist/${o}`);
        process.exit(1);
    }
}

async function preparePackageJson() {
    try {
        await assertNoWorkspaceImportsInDist();

        const packageJsonData = await fs.readFile(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonData);

        // Remove unnecessary properties
        delete packageJson.private;
        delete packageJson.publishConfig;

        // Update package name for public npm
        packageJson.name = 'prividium';

        // Set the new version
        packageJson.version = version;

        // Write the updated package.json back to the file
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

        console.log(`Updated package.json for version ${version}`);
        console.log(`Package name: ${packageJson.name}`);
    } catch (error) {
        console.error('Error updating package.json:', error);
        process.exit(1);
    }
}

preparePackageJson();
