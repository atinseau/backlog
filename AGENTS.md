# AGENTS.md

This repo is a **pnpm monorepo**. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before working in it.

## Layout (canonical)

- `packages/cli/` — `backlog` (Apache-2.0, npm: [`backlog`](https://www.npmjs.com/package/backlog))
- `packages/{core,claims,connectors,config,git,hooks,schemas}/` — workspace-internal modules, bundled into the CLI tarball at publish time
- `docs/ROADMAP.md` — multi-target roadmap (sources, repos, sandboxes, executors, deploy targets)
- Root `README.md` is symlinked from `packages/cli/README.md` (CLI README is the canonical one for npm)

## Package boundaries

- `packages/schemas/` (Zod) is the **source of truth for cross-boundary types**.
- Internal packages use `workspace:*` deps; tsup bundles everything for the published `backlog` tarball.
- The cloud backend (Backlog Cloud) lives in a private repo and is not part of this monorepo.

## Common commands

```sh
pnpm install                    # install workspace
pnpm test                       # vitest run (workspace-wide)
pnpm typecheck                  # tsc --noEmit per package
pnpm --filter backlog dev       # CLI dev mode (tsx)
pnpm --filter backlog build     # CLI build (tsup)
```

## CLI conventions

- Top-level canonical commands: `init`, `doctor` (no `setup` prefix).
- Grouped namespaces for the rest: `repos`, `work`, `task`, `claim`, `hooks`, `schedule`, `runs`, `agents`, `sources`, `release`, `worktree`.
- Version flag: `-v, --version` (lowercase).
- Default mode is fully local. Cloud sync (when available) is opt-in.

## License

`packages/cli/` ships under **Apache-2.0**. All workspace-internal packages are not published.

## Open core

- `osmove/backlog` — this repo (CLI only, Apache-2.0)
- Backlog Cloud — managed hosted backend, private repo, paid SaaS

See [docs/ROADMAP.md](./docs/ROADMAP.md) for the broader plan.
