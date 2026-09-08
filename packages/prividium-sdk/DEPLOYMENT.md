# SDK Deployment

## Regular releases

Handled automatically. Merging a PR that touches this package on main will publish a new version to npm based on
conventional commits.

## Publishing a specific version

```bash
git tag sdk-v<version>
git push origin sdk-v<version>
```

### Examples

```bash
# Beta
git tag sdk-v1.2.0-beta.1
git push origin sdk-v1.2.0-beta.1

# Release candidate
git tag sdk-v2.0.0-rc.1
git push origin sdk-v2.0.0-rc.1

# Hotfix for an older version
git tag sdk-v1.3.1
git push origin sdk-v1.3.1
```

The npm dist-tag is derived from the pre-release identifier (`-beta` → `beta`, `-rc` → `rc`). Versions without a
pre-release suffix get the `release` dist-tag. Only merge-to-main sets `latest`.

## Publish-shape guard

`@repo/api-types` is a workspace-only package and ships TypeScript source rather than compiled `.d.ts`. The SDK depends
on it for typecheck-time alignment (via the `admin-api/types-alignment.test.ts` test) but **must not** reference it from
any published file — external consumers cannot resolve `@repo/api-types`.

Two safety nets enforce this:

1. **`scripts/verify-publish-shape.ts`** — runs as `pnpm verify-publish-shape` (wired into both `prepublishOnly` and the
   `publish-sdk.yaml` workflow). It fails the publish if any `dist/sdk/*.{js,d.ts}` references `@repo/api-types`, or if
   `@repo/api-types` appears in `dependencies` / `peerDependencies` / `optionalDependencies`, or if the entry-point
   `.d.ts` files are missing curated admin types or `verifyUserAccessToken`.
2. **`scripts/pack-shape.test.ts`** — vitest integration test that runs `npm pack --dry-run` on every PR and inspects
   the actual tarball contents (the file list and the contents of entry `.d.ts` files).

If a publish fails the guard, do **not** silence it; investigate the leak. Most likely a new SDK file added an
`import { ... } from '@repo/api-types/...'` that wasn't `import type`-only, or a hand-written type in
`admin-api/types.ts` was replaced with a re-export from the workspace package.
