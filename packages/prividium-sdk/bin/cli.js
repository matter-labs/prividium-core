#!/usr/bin/env node
import { buildCli } from '../dist/cli/index.js';

buildCli()
    .parseAsync(process.argv.slice(2))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
