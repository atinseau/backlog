# Development Guide

This is the day-to-day engineering guide for the Backlog monorepo.
`CLAUDE.md` carries the architecture, the project's direction and the agent
rules; this file is the day-to-day engineering reference.

## Source Of Truth

- Install, usage, release flow: `README.md`
- Architecture, direction, agent rules: `CLAUDE.md`
- Known operational failures: `docs/TROUBLESHOOTING.md`

Do not create parallel release notes or hidden runbooks. Link to these files
instead.

## Toolchain

Bun 1.3+ is the only requirement — runtime, package manager, test runner, and
bundler. There is no Node, npm, pnpm, tsx, tsup, or vitest in this repo, and
none should come back.

## Package Map

| Package | Role |
| --- | --- |
| `packages/cli` | Command surface; `src/bin.ts` is the binary's entrypoint |
| `packages/board-ui` | Svelte 5 app, built by Vite, embedded in the binary |
| `packages/server` | Local Hono API server on `Bun.serve` |
| `packages/core` | Scheduler, run lifecycle, task/subtask services |
| `packages/config` | Project config, registry, project resolution |
| `packages/schemas` | Zod schemas and cross-boundary types |
| `packages/git` | Git status, clone, branches, worktrees, diffs |
| `packages/hooks` | Git hook install/status/runtime behavior |
| `packages/claims` | Claim store and claim context files |
| `packages/connectors` | Source/integration connector plumbing |

Nothing here is published. Internal packages are consumed through `workspace:*`
and expose their TypeScript source directly (`"main": "./src/index.ts"`) — no
per-package build step, no `dist/` inside a package. `bun build --compile`
pulls the sources in at build time.

Do not add runtime dependencies between packages casually: prefer `schemas`
for shared shapes and keep side-effectful services in the package that owns
the behavior.

## The Single Binary

`bun run build` runs `scripts/build.ts`, which:

1. builds the board with Vite into `packages/board-ui/dist`,
2. asserts every emitted file is embedded by
   `packages/server/src/ui-assets.ts`,
3. compiles everything into `dist/backlog` with `bun build --compile`.

Cross-compile with `bun run build --target bun-linux-x64` (also
`bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`).

Constraints that follow from shipping one binary:

- **Assets must be imported, not read from disk.** `ui-assets.ts` uses
  `import ... with { type: "file" }`; the default export is a path inside the
  executable that `Bun.file()` reads. Anything resolved relative to
  `import.meta.url` points at a virtual `/$bunfs/` location at runtime and
  will not find sibling files.
- **Asset filenames must be stable**, because those imports are literal paths.
  `packages/board-ui/vite.config.ts` pins `rollupOptions.output` instead of
  using content hashes. Adding an asset means adding an import and a
  `UI_ASSETS` entry — the build fails loudly if you forget.
- **Use `homeDir()` from `@backlog/config`, never `os.homedir()`.** Bun
  resolves `os.homedir()` from the password database and ignores a reassigned
  `HOME`; the tests rely on pointing `HOME` at a sandbox, and without this
  helper they write into the real `~/.backlog/`.
- The version is injected at build time from the root `package.json` via
  `--define __BACKLOG_VERSION__`, falling back to `0.0.0-dev` in dev runs.

## Naming

User-facing vocabulary:

- **Project**: the user's Backlog project, whether in-repo or user-level.
- **Repository**: a Git checkout tracked by a project.
- **Task**: high-level intent.
- **Subtask**: executable unit scoped to one repository.
- **Run**: one agent execution.
- **Claim**: path/file ownership lock.
- **Agent**: executable provider or manual assignee.
- **User/person**: local assignable human.

Avoid in new UI/docs/API:

- **Workspace** unless referring to the internal storage layout or old migration
  compatibility.
- Legacy task terminology. Use task/subtask.
- Abbreviated repository labels in product copy or new public-facing code names.
  Existing `repo`/`repos` API fields, CLI flags, routes, storage keys, and
  legacy symbols are compatibility names and should be migrated deliberately
  rather than renamed opportunistically.
- A standalone permission-management screen. Agent restrictions live with
  Agents.

## Local Development

From repository root:

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Nothing needs the board pre-built. `typecheck` and `test` pass without
`packages/board-ui/dist` — the `ui-assets.ts` imports are covered by the
ambient declarations in `types/`, and `static.ts` guards its dynamic import.
`bun run build` builds the board itself. And `predev` runs
`scripts/ensure-ui.ts`, which rebuilds it before a dev run only when it is
missing or stale, so `bun run dev serve` is always current while
`bun run dev status` stays instant. `bun run build:ui` forces a rebuild.

Run the board from source, without compiling:

```sh
bun run dev serve --port 7878 --project /path/to/your/project
# or open any folder without registering a project:
bun run dev serve --port 7878 --repository-only .
```

In a dev run the board is served from `packages/board-ui/dist` on disk, so a
rebuild is picked up on refresh without recompiling the binary — and `predev`
performs that rebuild for you when the sources have moved. If the page still
says "API ready, UI bundle missing", the build failed; run `bun run build:ui`
to see the error.

For UI work, run Vite with HMR in a second terminal instead:

```sh
bun run dev:ui        # http://localhost:5173
```

It proxies `/api` to `http://127.0.0.1:7878`; override with
`BACKLOG_API_URL=http://127.0.0.1:<port>`. Vite binds `localhost` (IPv6), so
use `localhost:5173` rather than `127.0.0.1:5173`.

## Testing Policy

Run the narrowest useful test while iterating, then broaden before committing.

```sh
bun test ./packages/server/src/routes/users.test.ts
bun test ./packages/core/src/scheduler.test.ts
bun test ./packages/core          # a whole package
```

`bun test` with no path argument silently misses packages. Always pass a path;
`bun run test` scopes it to `./packages`.

Before committing cross-package changes:

```sh
bun run typecheck
bun run test
bun run build
git diff --check
```

Tests run in one process, so module-level state leaks between files. Keep
fixtures in temp directories and point `HOME` at a sandbox when a test touches
user-level storage.

When tests create Git commits or merges, configure local test repo identity
inside the test (`git config user.name Backlog`, `git config user.email
backlog@example.com`) or pass `-c user.name=... -c user.email=...` to Git. CI
runners do not guarantee global Git identity.

## UI And Board Conventions

- Svelte UI lives in `packages/board-ui`.
- Visible copy must be added in both `i18n/en.json` and `i18n/fr.json`.
- Operational screens should feel like tools: dense, scan-friendly, restrained.
- Avoid marketing copy inside the app.
- Buttons should use clear command labels. In Repositories, command buttons are
  uppercase.
- Repository removal means detach from Backlog only. It must not delete local
  folders, delete Git data, or cascade through tasks/subtasks/agents from the
  board UI.
- Hook status must be visible in Repositories. If a hook is missing or outdated,
  show an install/update action.
- If an action changes server state, add or update the route/API wrapper and
  route tests.

## Git, Hooks, And Claims

Hooks are installed per tracked repo and call back into Backlog before commits.

The pre-commit hook goes through a shim written by
`packages/config/src/shim.ts`. Git's hook environment has a minimal PATH, so
the shim resolves the executable itself: `$BACKLOG_DEV_BIN`, then
`<project>/dist/backlog`, then `backlog` on PATH, then `~/.local/bin/backlog`.
It execs the binary directly — no runtime or package manager at hook time.

Rules:

- Expired claims should not block commits.
- Orphaned hook context should self-heal where possible.
- Hook status includes missing, foreign, managed/current, managed/outdated.
- Board UI should surface hook update/install when status says action is needed.
- `BACKLOG_SKIP_HOOK=1 git commit ...` is an escape hatch for maintenance
  commits, not a normal product path.

## Projects And Repositories

Backlog supports two storage layouts:

- `in_repo`: `<repo>/.backlog`
- `user_level`: `~/.backlog/<slug>`

Use "project" in public language for both. Use "workspace" only for legacy code
or internal storage explanations.

Repository paths can be local or cloned from a Git URL.

## Hosted-Service Boundary

This fork is local-first with no hosted backend. The `/cloud/*` routes in
`packages/server/src/routes/integrations.ts` proxy an account/billing service
that upstream ran and this fork does not. They answer `503 cloud_disabled`
unless `BACKLOG_CLOUD_URL` is set, `/cloud/me` reports `available: false`, and
the board hides sign-in and billing entries accordingly.

Integrations (GitHub, Jira) work in BYO mode: supply your own OAuth app
credentials in Settings → Integrations.

## Release

1. Make code/docs changes.
2. Run the validation commands from "Testing Policy".
3. Bump `version` in the root `package.json`.
4. Open a PR; merge it to `main`.

CI then builds all four binaries, tags `v<version>`, and attaches them plus
`SHA256SUMS` to a GitHub Release. A merge that leaves the version untouched
releases nothing, so ordinary PRs are safe.

Verify with `gh release view v<version> --json url,assets`.

## What To Update When Behavior Changes

- CLI command or flag: CLI code, README command list, tests.
- Board UI flow: Svelte component, i18n EN/FR, API wrapper if needed,
  server route tests if server state changes.
- Server API shape: route schema, core service/types, UI API wrapper, tests.
- Cross-package data shape: `packages/schemas`, migrations/defaults if needed,
  all call sites.
- Git behavior: `packages/git` or `packages/core`, tests using real temp repos,
  troubleshooting docs if user-facing.
- Hook behavior: `packages/hooks`, hook status UI/API, troubleshooting docs.
- Build or embedding behavior: `scripts/build.ts`, `ui-assets.ts`, this guide.
