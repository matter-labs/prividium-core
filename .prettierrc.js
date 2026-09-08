/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
module.exports = {
    // Common settings
    printWidth: 120,
    singleQuote: true,
    trailingComma: 'none',
    bracketSpacing: true,

    // File type specific overrides
    overrides: [
        // JSON files
        {
            files: ['*.json'],
            options: {
                tabWidth: 4
            }
        },
        // JavaScript/JSX files
        {
            files: ['*.js', '*.jsx', '*.mjs', '*.cjs'],
            options: {
                tabWidth: 4
            }
        },
        // TypeScript/TSX files
        {
            files: ['*.ts', '*.tsx', '*.mts', '*.cts'],
            options: {
                tabWidth: 4,
                parser: 'typescript'
            }
        },
        // Vue files
        {
            files: ['*.vue'],
            options: {
                tabWidth: 4
            }
        },
        // Markdown files
        {
            files: ['*.md'],
            options: {
                tabWidth: 2,
                parser: 'markdown',
                proseWrap: 'always'
            }
        }
    ]
};
