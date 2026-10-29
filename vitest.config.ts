import * as os from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            '{apps,packages}/*/vitest.config.{ts,mts,cts,js,mjs,cjs}',
            { test: { name: 'scripts', include: ['scripts/*.test.mjs'] } }
        ],
        maxWorkers: Math.min(16, os.availableParallelism())
    }
});
