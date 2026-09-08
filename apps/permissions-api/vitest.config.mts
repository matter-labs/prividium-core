import path from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
    test: {
        environment: 'node',
        globalSetup: './test/global-setup.ts',
        hookTimeout: 30_000,
        testTimeout: 20_000,
        isolate: false
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    }
});
