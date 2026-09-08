import { beforeAll, describe, expect, it } from 'vitest';
import { buildCliPackage, spawnCli } from './cli-test-utils/run-cli.js';

// This suite intentionally spawns the compiled `bin/cli.js` as a subprocess.
// The verify-command tests run in-process for coverage, but that path bypasses
// module resolution, the shebang, and package.json exports — so we keep one
// spawn-based smoke test to catch breakage in the shipped binary.
describe('CLI smoke tests', () => {
    beforeAll(async () => {
        await buildCliPackage();
    }, 60_000);

    const invocations = [[['--help']], [['doctor', '--help']], [['proxy', '--help']], [['config', '--help']]];

    it.each(invocations)('runs `node bin/cli.js %j` successfully', async (args) => {
        const { exitCode, stdout, stderr } = await spawnCli(args);

        expect(stderr).toBe('');
        expect(exitCode).toBe(0);
        expect(stderr).not.toContain('ERR_MODULE_NOT_FOUND');
        expect(stdout).toContain('prividium-cli');
    });
});
