/**
 * Monkey-patches git-log-parser to filter commits to only those
 * touching files in this SDK package
 *
 * Based on semantic-release-commit-filter approach.
 */
const { posix } = require('node:path');

Object.keys(require.cache)
    .filter((m) => posix.normalize(m).endsWith('/node_modules/git-log-parser/src/index.js'))
    .forEach((moduleName) => {
        const parse = require.cache[moduleName].exports.parse;
        require.cache[moduleName].exports.parse = (config, options) => {
            // Use options.cwd (the SDK directory path)
            if (Array.isArray(config._)) config._.push(options.cwd);
            else if (config._) config._ = [config._, options.cwd];
            else config._ = options.cwd;
            return parse(config, options);
        };
    });

module.exports = {};
