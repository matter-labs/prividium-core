import * as os from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: ['{apps,packages}/*/vitest.config.{ts,mts,cts,js,mjs,cjs}'],
        maxWorkers: Math.min(16, os.availableParallelism())
    }
});
