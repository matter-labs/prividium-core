module.exports = {
    extends: ['./filter-sdk-commits.cjs'],
    branches: ['main'],
    tagFormat: 'sdk-v${version}',
    plugins: [
        [
            '@semantic-release/commit-analyzer',
            {
                // Mirrors root .releaserc.js: major bumps require `MAJOR BUMP: <description>` footer.
                parserOpts: {
                    noteKeywords: ['MAJOR BUMP'],
                    notesPattern: (keywords) => new RegExp(`^(${keywords}): (.+)$`)
                }
            }
        ],
        [
            '@semantic-release/release-notes-generator',
            {
                parserOpts: {
                    noteKeywords: ['MAJOR BUMP'],
                    notesPattern: (keywords) => new RegExp(`^(${keywords}): (.+)$`)
                }
            }
        ],
        [
            '@semantic-release/exec',
            {
                prepareCmd: 'INPUT_VERSION=${nextRelease.version} node prepare-package.mjs',
                publishCmd: 'npm publish --access public --tag latest',
                successCmd:
                    'echo "published=true" >> $GITHUB_OUTPUT && echo "version=${nextRelease.version}" >> $GITHUB_OUTPUT'
            }
        ],
        [
            '@semantic-release/github',
            {
                successComment: false,
                failComment: false
            }
        ]
    ]
};
