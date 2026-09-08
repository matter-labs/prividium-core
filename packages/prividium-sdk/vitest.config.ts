import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        globals: true,
        testTimeout: 5000,
        isolate: true
    },
    resolve: {
        alias: [
            {
                find: /^@repo\/prividium-sdk\/siwe$/,
                replacement: fileURLToPath(new URL('./src/siwe.ts', import.meta.url))
            },
            {
                find: /^@repo\/prividium-sdk$/,
                replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url))
            }
        ]
    }
});
