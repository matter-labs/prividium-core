import esbuild from 'esbuild';
import { nodeExternalsPlugin } from 'esbuild-node-externals';
import { scriptLogger } from './scripts/script-logger';

async function main() {
    const config = {
        entryPoints: ['./src/main.ts'],
        outfile: 'dist/index.js',
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        logLevel: 'info',
        sourcemap: 'external',
        minify: true,
        legalComments: 'none',
        plugins: [
            nodeExternalsPlugin({
                allowWorkspaces: true
            })
        ]
    } satisfies esbuild.BuildOptions;

    if (process.argv.includes('--watch')) {
        const ctx = await esbuild.context(config);
        await ctx.watch();
        return;
    }

    await esbuild.build(config);
    await esbuild.build({
        entryPoints: ['./check-env.ts'],
        outfile: './dist/check-env.js',
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        minify: true,
        sourcemap: false,
        legalComments: 'none',
        // Keep npm deps external like the main bundle: inlining CJS deps breaks ESM output.
        plugins: [
            nodeExternalsPlugin({
                allowWorkspaces: true
            })
        ]
    });
}

main().catch((err) => {
    scriptLogger.error(err);
    process.exit(1);
});
