# Contribution Guidelines

Thanks for your interest in Prividium Core! We welcome contributions from anyone on the internet.

Note, however, that all contributions are subject to review, and not every contribution is guaranteed to be merged. It
is highly advised to reach out to the maintainers -- for example, by opening an issue -- before preparing a significant
change, and to explicitly confirm that the contribution will be considered for merge. Otherwise it is possible to
discover that a feature you have spent time on does not align with the maintainers' vision, or with their capacity to
maintain it long term.

## Ways to contribute

1. Open issues: if you find a bug, have something you believe needs to be fixed, or have an idea for a feature, please
   open an issue.
2. Add colour to existing issues: provide screenshots, code snippets, and whatever you think would help resolve them.
3. Resolve issues: either by showing that an issue is not a problem and the current state is fine, or by fixing the
   problem and opening a pull request.
4. Report security issues: see [our security policy](./SECURITY.md). Never report a suspected vulnerability in a public
   issue, pull request, or discussion.

## What is in this repository

Prividium Core is a TypeScript monorepo built with pnpm workspaces and Turborepo. It holds the permissions API and the
packages it depends on, including the public Prividium SDK. The README covers what the project is and how to run it.

## Prerequisites

- Node.js at the version in `.nvmrc`.
- pnpm at the version in the `packageManager` field of the root `package.json`. `corepack enable` picks it up.
- Docker, to run the PostgreSQL instance the tests need.

## Build

```sh
pnpm install --frozen-lockfile
pnpm --filter @repo/permissions-api run export-openapi-spec
pnpm build
pnpm typecheck
```

The OpenAPI spec is generated, not committed, and the build does not generate it for you. Export it once after a fresh
clone, and again whenever you change an API route.

## Test

The permissions API test suite creates throwaway databases, so it needs a PostgreSQL server reachable at
`postgres://postgres:notsecurepassword@localhost:5500`:

```sh
docker run -d --name prividium-test-postgres \
  --shm-size=1g \
  -p 127.0.0.1:5500:5432 \
  -e POSTGRES_PASSWORD=notsecurepassword \
  postgres:18 \
  -c max_connections=1000 \
  -c fsync=off \
  -c synchronous_commit=off \
  -c full_page_writes=off
```

Durability is off on purpose: the volume is throwaway and the suite is write-heavy. `max_connections` and the
shared-memory size are raised because the suite runs many workers in parallel.

Then:

```sh
pnpm test
```

Suites that do not touch the database run on their own, without a server:

```sh
pnpm --filter @repo/prividium-sdk test
pnpm --filter @repo/access-control test
```

## Lint and format

Biome is the linter and formatter. It reads `biome.config.json`, not the conventional `biome.json`, and both scripts
pass that path explicitly:

```sh
pnpm biome       # lint and format with auto-fix
pnpm biome:check # lint and format check only
```

## Making a change

To contribute code, fork the repository, make your change, and open a pull request for the maintainers to review. See
[the GitHub documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork)
for how to work with pull requests created from a fork.

1. Branch from `main`.
2. Keep one logical change per pull request.
3. Add tests for behaviour you change.
4. Run `pnpm build`, `pnpm typecheck`, and `pnpm test` before you push.
5. Fill in the pull request template.

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Version bumps are derived from the commit
type, so the type matters:

```text
feat: add wallet management
fix: handle session redirect
chore: update deps
docs: update readme
```

`feat` bumps the minor version. `fix` and `docs` bump the patch version. `chore` releases nothing.

A major bump needs a `MAJOR BUMP: <description>` footer in the commit body. The `BREAKING CHANGE` footer and the `!`
suffix (`feat!:`) are **not** recognised by this repository's parser and are rejected by CI.

## Merging

Pull requests are squash-merged. The squash commit message becomes the release entry, so the pull request title must
itself be a valid conventional commit message. Individual commits inside a pull request are not required to be.

Branch history is linear -- rebase onto `main` rather than merging `main` into your branch.

## Contribution terms

This project is licensed under the Apache License 2.0; see [LICENSE.md](./LICENSE.md) and [NOTICE](./NOTICE).
Contributions are governed by a Contributor License Agreement (CLA), which Matter Labs requires before a contribution
can be merged. The CLA grants Matter Labs a license to your contribution; you keep the copyright.

- Contributing as an individual: sign the [Individual CLA](./CLA/INDIVIDUAL_CLA.md). A bot asks you to sign it on your
  first pull request and blocks the merge until you have.
- Contributing for an employer: your employer signs the [Corporate CLA](./CLA/CORPORATE_CLA.md), lists you as a
  designated contributor, and sends the signed agreement to <legal@matterlabs.dev>. Once Matter Labs acknowledges it,
  your pull requests pass the CLA check without an individual signature.

## Code of conduct

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
