# Prividium Core

Prividium Core is the permissioned RPC proxy and permissions API behind a Prividium® network. It authenticates callers,
applies role-based permissions to JSON-RPC and REST requests, and forwards what it allows to a ZKsync sequencer.

Prividium Core is one component of the Prividium product. It is not the full commercial offering: the admin and user web
applications, the deployment and operations tooling, and the managed service Matter Labs sells around it are not part of
this repository.

Prividium is a registered trademark of Matter Labs. Use of the Prividium name for modified or redistributed versions
requires written approval from Matter Labs.

This workspace holds the API service and the packages it depends on:

| Package                   | What it is                                              |
| ------------------------- | ------------------------------------------------------- |
| `apps/permissions-api`    | Fastify REST + JSON-RPC service (port 8000 by default)  |
| `packages/prividium-sdk`  | Client SDK and `prividium` CLI                          |
| `packages/access-control` | Permission evaluation helpers                           |
| `packages/api-kit`        | Shared Fastify, database, and error-handling helpers    |
| `packages/api-types`      | TypeScript client generated from the API's OpenAPI spec |
| `packages/api-metrics`    | Prometheus metric helpers                               |
| `packages/test-deps`      | Test infrastructure helpers                             |

## Prerequisites

- Node.js — the version in `.nvmrc` (`nvm use` picks it up)
- pnpm 10.28.1 — the version pinned in `packageManager`
- A PostgreSQL database the API can reach

## Get a Postgres

Any reachable PostgreSQL instance works — managed, local, or a container. Docker is one way to get one, not a
requirement for running the app:

```sh
docker run -d --name prividium-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=prividium \
  -p 5432:5432 postgres:18
```

## Install

```sh
pnpm install
```

## Configure

The API reads `.env` and `.env.local` from its own directory. Start from the example:

```sh
cp apps/permissions-api/.env.example apps/permissions-api/.env
```

Two values in that file need attention before the first run:

- `DATABASE_URL` — point it at your database. As an alternative, unset it and set all five of `DATABASE_HOST`,
  `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME`.
- `AUTH_METHODS` — the example enables `oidc,crypto_native`. `oidc` requires a reachable OIDC provider configured
  through `OIDC_JWKS_URI`, `OIDC_JWT_ISSUER`, and `OIDC_JWT_AUD`. To start without one, set `AUTH_METHODS=crypto_native`
  and authenticate with wallet signatures (SIWE).

Everything else in the example boots as-is. The API validates its configuration at startup and names any variable that
is missing or malformed.

## Migrate

Migrations run automatically at startup only when `NODE_ENV=production`. In development, apply them yourself:

```sh
pnpm --filter @repo/permissions-api db:migrate
```

## Create the first admin

Migrations create the schema, not the baseline roles. Seed them, then name the wallet that owns the chain:

```sh
pnpm --filter @repo/permissions-api db:seed
```

That creates two zone-level roles: `admin`, which carries every system permission, and `user`, which carries none. Set
`CRYPTO_NATIVE_ADMIN_WALLETS` in `apps/permissions-api/.env` to your address — a comma-separated list — and the first
time that wallet signs in, the API provisions it an account with the `admin` role. `OIDC_ADMIN_SUBS` does the same for
an OIDC subject.

Two checks that the admin is real: `/docs` answers for the seeded admin (`SWAGGER_UI_ALLOWED_ROLES` defaults to
`admin`), and `prividium doctor` from the SDK CLI reports on the setup.

## Run

```sh
pnpm dev
```

This builds the SDK and starts the API in watch mode.

## Check it is up

```sh
curl http://localhost:8000/health   # PORT in .env sets the port
```

A healthy service answers `200` with the database probe passing:

```json
{ "ok": true, "checks": { "database": { "ok": true } }, "updatedAt": "...", "version": "local-dev" }
```

`/readyz` returns the same payload. `500` on either means a probe failed — `checks` says which one.

## Build and typecheck

`pnpm build` and `pnpm typecheck` need the TypeScript client in `packages/api-types`, which is generated from an OpenAPI
spec the API exports. Export it once after a fresh clone, and again whenever an API route changes:

```sh
pnpm --filter @repo/permissions-api run export-openapi-spec
pnpm build
pnpm typecheck
```

## Other commands

```sh
pnpm biome        # lint and format with auto-fix
pnpm biome:check  # lint and format check only
pnpm fmt:md       # format markdown with Prettier
pnpm fmt:md:check # markdown format check only
```

Biome reads `biome.config.json`, not the conventional `biome.json`. Both scripts pass it explicitly; an editor
integration needs the same path configured.
