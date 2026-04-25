# AGENTS.md

This repo is a **pnpm monorepo**. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before working in it.

## Layout (canonical)

- `packages/cli/` — `backlog` (Apache-2.0, npm: [`backlog`](https://www.npmjs.com/package/backlog))
- `packages/server/` — `@osmove/backlog-server` (BUSL-1.1, scaffold)
- `packages/{core,claims,connectors,config,git,hooks,schemas}/` — workspace-internal modules
- `docs/ROADMAP.md` — multi-target roadmap (sources, repos, sandboxes, executors, deploy targets)
- Root `README.md` is symlinked from `packages/cli/README.md` (CLI README is the canonical one for npm)

## Package boundaries

- `packages/schemas/` (Zod) is the **source of truth for cross-boundary types**. Both CLI and server import from there.
- Internal packages use `workspace:*` deps; tsup bundles everything for the published `backlog` tarball.
- Server (`packages/server/`) is a separate publishable artifact (`@osmove/backlog-server`), not bundled into CLI.

## Common commands

```sh
pnpm install                                   # install workspace
pnpm test                                      # vitest run (workspace-wide)
pnpm typecheck                                 # tsc -b
pnpm --filter backlog dev                      # CLI dev mode (tsx)
pnpm --filter backlog build                    # CLI build (tsup)
pnpm --filter @osmove/backlog-server dev       # server dev mode
pnpm --filter @osmove/backlog-server build     # server build
```

## CLI conventions

- Top-level canonical commands: `init`, `doctor` (no `setup` prefix).
- Grouped namespaces for the rest: `repos`, `work`, `task`, `claim`, `hooks`, `schedule`, `runs`, `agents`, `sources`, `release`, `worktree`.
- Version flag: `-v, --version` (lowercase).
- Default mode is fully local. Cloud sync is opt-in.

## Server conventions

- Default port: `3002` (`PORT` env to override).
- Health: `GET /` and `GET /health` return JSON with `{name, version, status}`.
- All API routes will live under `/api/v1/`.
- Database: SQLite via Drizzle (default), Postgres optional via `DATABASE_URL`.

## Two-license model

- `packages/cli/` ships under **Apache-2.0**.
- `packages/server/` ships under **BUSL-1.1** with **Change Date 2030-04-25 → Apache-2.0**.
- All other internal packages are workspace-only and never published.

## Open core

- `osmove/backlog` — this repo (CLI + OSS server)
- `osmove/backlog-cloud` — private SaaS wrapper (does not exist yet, planned)

See [docs/ROADMAP.md](./docs/ROADMAP.md) for the full plan.
