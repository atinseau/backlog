# Development Guide

This is the day-to-day engineering guide for the open-source Backlog monorepo.
`AGENTS.md` is the short agent boot card; this file is the durable reference.

## Source Of Truth

- Product README: `packages/cli/README.md` (root `README.md` is a symlink)
- Changelog: `packages/cli/CHANGELOG.md` (root `CHANGELOG.md` is a symlink)
- Agent rules: `AGENTS.md`
- Release/deploy runbook: `RELEASING.md`
- Known operational failures: `docs/TROUBLESHOOTING.md`
- Roadmap and strategy: `docs/ROADMAP.md`

Do not create parallel release notes or hidden runbooks. Link to these files
instead.

## Package Map

| Package | Role | Published? |
| --- | --- | --- |
| `packages/cli` | `backlog` CLI, bundles the board UI and internal packages | yes, npm `backlog` |
| `packages/desktop` | Electron shell around the local server + board UI | no npm publish, GitHub Releases |
| `packages/board-ui` | Svelte app shared by CLI `serve` and Desktop | no |
| `packages/server` | Local Hono API server | no |
| `packages/core` | Scheduler, run lifecycle, task/subtask services | no |
| `packages/config` | Project config, registry, project resolution | no |
| `packages/schemas` | Zod schemas and cross-boundary types | no |
| `packages/git` | Git status, clone, branches, worktrees, diffs | no |
| `packages/hooks` | Git hook install/status/runtime behavior | no |
| `packages/claims` | Claim store and claim context files | no |
| `packages/connectors` | Source/integration connector plumbing | no |
| `packages/sdk` | Legacy/current generated SDK package | yes, when changed |

Internal packages are consumed through `workspace:*` and bundled into the CLI
tarball by `tsup`. Do not add runtime dependencies between packages casually:
prefer `schemas` for shared shapes and keep side-effectful services in the
package that owns the behavior.

## Naming

User-facing vocabulary:

- **Project**: the user's Backlog project, whether in-repo or user-level.
- **Repository**: a Git checkout tracked by a project.
- **Task**: high-level intent.
- **Subtask**: executable unit scoped to one repository.
- **Run**: one agent execution.
- **Claim**: path/file ownership lock.
- **Agent**: executable provider or manual assignee.
- **User/person**: local assignable human; invitations require Backlog Cloud.

Avoid in new UI/docs/API:

- **Workspace** unless referring to the internal storage layout or old migration
  compatibility.
- Legacy task terminology. Use task/subtask.
- Abbreviated repository labels in product copy or new public-facing code names. Existing
  `repo`/`repos` API fields, CLI flags, routes, storage keys, and legacy symbols
  are compatibility names and should be migrated deliberately rather than
  renamed opportunistically.
- A standalone permission-management screen. Agent restrictions live with
  Agents.

## Local Development

From repository root:

```sh
pnpm install
pnpm typecheck
pnpm --filter @backlog/board-ui typecheck
pnpm test
pnpm --filter "backlog..." build
pnpm --filter @backlog/desktop build
pnpm --filter backlog pack:check
```

Run the board in development:

```sh
pnpm --filter backlog dev serve --project /Users/jimmy/Dev/backlog/backlog-cli --port 7878
```

If `backlog serve` shows "API ready, UI bundle missing":

```sh
pnpm --filter @backlog/board-ui build
```

The local board should then answer at `http://127.0.0.1:7878`.

## Testing Policy

Run the narrowest useful test while iterating, then broaden before committing.

Useful targets:

```sh
pnpm test -- packages/server/src/routes/users.test.ts
pnpm test -- packages/core/src/scheduler.test.ts
pnpm test -- packages/server/src/routes/commits.test.ts
pnpm --filter @backlog/board-ui typecheck
```

Before release or cross-package changes:

```sh
pnpm typecheck
pnpm --filter @backlog/board-ui typecheck
pnpm test
pnpm --filter "backlog..." build
pnpm --filter @backlog/desktop build
pnpm --filter backlog pack:check
git diff --check
```

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

Repository paths can be local or cloned from a Git URL. Remote GitHub
repositories without local checkout are Backlog Cloud work and should be
introduced as Cloud-gated UI/API, not as fake local behavior.

## Backlog Cloud Boundary

The open-source repo must stay local-first. Features that only need user-owned
credentials or a local process stay open source. Features that require Osmove
infrastructure belong to Backlog Cloud:

- hosted auth and account/team state
- SMTP invitation delivery
- shared multi-user project sync
- hosted executors/sandboxes
- hosted run retention and audit exports
- billing/admin SaaS behavior

The private backend repo is `../backlog-backend` locally.

## Release And Deploy

Use `RELEASING.md` for the step-by-step release runbook.

Quick shape for CLI + Desktop patch releases:

1. Make code/docs changes.
2. Run validation commands from "Testing Policy".
3. Bump `packages/cli/package.json` and `packages/desktop/package.json`.
4. Add a changelog section in `packages/cli/CHANGELOG.md`.
5. Commit.
6. Tag both `vX.Y.Z` and `desktop-vX.Y.Z`.
7. Push `main`, then both tags.
8. Watch GitHub Actions:
   - `CI` on `main`
   - `Desktop release` on `desktop-vX.Y.Z`
9. Verify:
   - `npm view backlog version`
   - `gh release view vX.Y.Z --json isDraft,url`

The Desktop workflow publishes the CLI idempotently from the `desktop-v*` tag
and uploads platform installers to the GitHub Release `vX.Y.Z`.

## What To Update When Behavior Changes

- CLI command or flag: CLI code, README command table, tests, changelog.
- Board UI flow: Svelte component, i18n EN/FR, API wrapper if needed,
  server route tests if server state changes.
- Server API shape: route schema, core service/types, UI API wrapper, tests.
- Cross-package data shape: `packages/schemas`, migrations/defaults if needed,
  all call sites.
- Git behavior: `packages/git` or `packages/core`, tests using real temp repos,
  troubleshooting docs if user-facing.
- Hook behavior: `packages/hooks`, hook status UI/API, troubleshooting docs.
- Release process: `RELEASING.md` and this guide.
