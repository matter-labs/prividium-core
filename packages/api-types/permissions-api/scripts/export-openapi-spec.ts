import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PERMISSIONS_API_DIR = path.resolve(__dirname, '..');
const GENERATED_PATH = path.join(PERMISSIONS_API_DIR, 'generated');

const SPEC_PATH = path.join(PERMISSIONS_API_DIR, 'spec');
const OPENAPI_SPEC_JSON_PATH = path.join(SPEC_PATH, 'openapi-spec.json');

// Mock dependencies - we just need the app structure to generate the OpenAPI spec

function generateClient() {
    console.log('    🔄 Generating OpenAPI client...');
    const configPath = join(PERMISSIONS_API_DIR, 'openapi-ts.config.ts');
    execSync(`pnpm exec openapi-ts -f "${configPath}"`, {
        cwd: PERMISSIONS_API_DIR,
        stdio: 'inherit'
    });

    // Create index.ts file for the generated client
    const indexPath = join(GENERATED_PATH, 'index.ts');
    const indexContent = `// Auto-generated exports for permissions-api client
export * from './types.gen';
export * from './sdk.gen';
export { createClient, createConfig } from './client';
`;
    writeFileSync(indexPath, indexContent);

    console.log('    ✅ Client generated successfully!');
}

function assertOpenApiFileExists(): void {
    if (!existsSync(OPENAPI_SPEC_JSON_PATH)) {
        throw new Error('Missing open api spec');
    }
}

function main() {
    try {
        console.log('🔄 Generating Permissions API client...');
        assertOpenApiFileExists();
        generateClient();
        console.log('✅ OpenAPI client generated successfully!');
    } catch (error) {
        console.error('‼️ Failed to generate client:', error);
        process.exit(1);
    }
}

main();
