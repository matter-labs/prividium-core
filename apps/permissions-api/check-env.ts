// @ts-expect-error We execute this with `node --experimental-strip-types`, that's why we need extension.
import { loadEnv } from './src/env.ts';

loadEnv();
