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

## Workspace location convention

Two layouts, both seeded by `backlog init`:

- **`in_repo`** (default) — workspace at `<project root>/.backlog/`. Right
  for single-repo projects.
- **`user_level`** (opt-in via `--user-level`) — workspace at
  `~/.backlog/<slug>/`. Right for multi-repo projects so the workspace
  isn't tied to one repo. `<slug>` must not collide with another
  registered user-level project.

Both layouts share the same internal file shape (`config.toml` plus the
YAML/JSON state files). The choice is recorded in `config.toml` as
`project_location`, mirrored in the user registry's per-entry `location`
field.

The user registry (`projects.json`) lives at `~/.backlog/projects.json` on
every platform — same location as user-level workspaces, in keeping with
CLI tool conventions (`~/.gitconfig`, `~/.npm/`, etc.). Older registries
under `~/Library/Application Support/Backlog/` (macOS) or `~/.config/Backlog/`
(Linux) are auto-migrated on first read.

Resolution from a CLI invocation:

1. `BACKLOG_PROJECT_DIR` env var (used by the pre-commit hook)
2. cwd has `config.toml` → that's the user_level workspace itself
3. Walk up looking for `<x>/.backlog/` containing `config.toml`
4. Registry fallback — for each `user_level` entry, check whether cwd is
   inside one of its registered repos; first match wins

Switch layouts with `backlog project migrate <id> --to user-level` (or
`--to in-repo --into <repo-id>`).

## License

`packages/cli/` ships under **Apache-2.0**. All workspace-internal packages are not published.

## Open core

- `osmove/backlog` — this repo (CLI only, Apache-2.0)
- Backlog Cloud — managed hosted backend, private repo, paid SaaS

See [docs/ROADMAP.md](./docs/ROADMAP.md) for the broader plan.
