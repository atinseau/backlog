# Changelog

All notable changes to the `backlog` CLI are documented here. The 1.0.0–1.2.0 history lives in [`CHANGELOG-LEGACY.md`](./CHANGELOG-LEGACY.md).

## [Unreleased]

## [1.3.0] - 2026-04-29

The natural follow-up to 1.2.0. Brings the open-core boundary, the Desktop preview, and everything that was sitting in Unreleased onto a stable 1.x release.

### Highlights

- **Backlog Desktop** ([backlog.so/desktop](https://backlog.so/desktop), `packages/desktop/`) is now the recommended way to run the kanban for non-terminal users. Electron shell around the same `@backlog/server` + `@backlog/board-ui` the CLI already runs — one engine, one feature surface. The macOS DMG (Apple Silicon + Intel) is in Apple notarisation; Windows + Linux follow via the same `electron-builder` config. Free, Apache-2.0, full feature parity with `backlog serve`.
- **Open-core boundary made explicit.** CLI + Desktop + SDK are free forever under Apache-2.0. Backlog Cloud (private development, [waitlist](https://backlog.so/cloud)) only adds features that genuinely need infrastructure we run: SMTP for invites and digests, hosted auth & SSO (SAML/OIDC, SCIM), multi-tenant collaboration with real-time sync, hosted run executors (managed agents, ephemeral sandboxes), retention beyond local disk, audit log export. The boundary maps to *infrastructure we run*, not features we artificially gate.
- **Marketing surface refreshed** at [backlog.so](https://backlog.so): dedicated `/cli`, `/desktop`, `/sdk`, `/cloud` pages, an anonymous waitlist for Desktop and Cloud, and a flesh-out `/docs` covering quickstart, concepts, full CLI reference, workspace layout, configuration, the orchestrator, claims & the pre-commit hook, agents, connectors, the API, self-hosting, and troubleshooting.
- **Embedded server port fix** (`packages/server/src/index.ts`). `startServer({ port: 0 })` now returns the actually-bound port (read from `server.address()`) instead of echoing the requested `0`. Required for Electron's random-port boot; the CLI gets the fix for free, so `backlog serve --port 0` no longer reports the wrong URL.
- **`backlog hooks pause` / `backlog hooks resume`** are now first-class subcommands (previously only documented as escape-hatches). Pausing covers a 30-minute window so you can do a sequence of commits without the per-commit `BACKLOG_SKIP_HOOK=1` dance; resume re-enables on the spot.

### Workspace & projects

- **`backlog init`** initializes a workspace in the current directory; **`backlog init --user-level`** places it at `~/.backlog/<slug>/` for multi-repo projects without a single natural project root. Project name uniqueness is enforced across user-level entries.
- **`config.toml` carries `project_location`** (`in_repo` | `user_level`), mirrored in the user registry's per-entry `location`. The cross-platform registry path is `~/.backlog/projects.json`; legacy registries under `~/Library/Application Support/Backlog/` (macOS) or `~/.config/Backlog/` (Linux) are auto-migrated on first read.
- **`backlog project migrate <id> --to user-level`** (or `--to in-repo --into <repo-id>`) moves an existing workspace between layouts, copying state, rewriting `config.toml`, updating the registry, force-reinstalling hooks, and renaming the old dir to `.backlog.migrated-YYYY-MM-DD/` for rollback.
- **Projects** — first-class entity grouping one or many repos. Each work item can carry a `project_id`. CLI: `backlog project add|list|show|update|archive|remove`. Storage: `.backlog/projects.yaml`.

### Kanban board (`backlog serve`)

- **`backlog serve`** — local Hono server + Svelte 5 kanban board on `127.0.0.1:7878`, single binary. Cards drag between À faire / En cours / In Review / Done; live updates via SSE on every state mutation. Project dropdown + ⚙ Projects modal, 📁 Repos modal, 🔒 Permissions modal, ✂ splitter, `+ Ticket` and `+ Claim` modals.
- **Persistent orchestrator** — start/pause/stop a background loop that re-builds the execution plan and dispatches runs every `tick_interval_ms` (default 5s). Pause is soft (active runs keep going), stop drains. Hydrates only when `last_tick_at < 60s` to avoid surprise auto-launches. CLI: `backlog orchestrator start|pause|stop|status|config`. UI: ▶ ⏸ ⏹ trio in the topbar.
- **Live time estimates and progress** — every task gets `estimated_duration_seconds` (manual override or median of archived runs filtered by repo+lane, fallback 30 min) plus a derived `progress_percent`. Work-item progress is duration-weighted. The `/board` payload exposes `progress_percent`, `eta`, `elapsed_seconds`, `total_estimated_seconds`, `total_remaining_seconds`. UI shows a 4 px progress bar per task, ETA badge ticking every second, plus a global ETA pill.
- **Drag-to-reorder inside columns** — rewrites a sparse `priority_score` (work items use `rank`). Cross-column drag still triggers status change.
- **Repo management UI + API** — `/api/v1/repos` (GET/POST/PATCH/DELETE) wraps `@backlog/core`'s repo-service. List, add, rename, enable/disable, force-delete repos from the kanban.
- **GitHub / GitLab / Bitbucket / arbitrary Git URL clone** — repos can be added by URL. `RepoConfig` gains `git_url` and `provider`. `cloneAndAddRepo()` clones into `<workspace>/repos/<id>` by default. CLI: `backlog repos add --url ...`.
- **Permissions screen** — toggle workspace autonomy mode (observe / assist / delegate / autopilot), edit per-claim TTL and `enforce_on_commit`, configure each agent (enable, sandbox mode, success mode, concurrence, allowed risks, allowed repos).
- **Mechanical splitter + AI splitter** — ✂ button on work items without tasks. AI tab calls Claude (`claude-opus-4-7` by default, overridable via `BACKLOG_AI_MODEL`) with adaptive thinking and JSON-schema constrained output. Requires `ANTHROPIC_API_KEY`; degrades gracefully without.

### CLI commands

- `backlog init`, `backlog doctor`, `backlog status`, `backlog serve`
- `backlog project {add|list|show|update|archive|remove|migrate|migrate-rollback|export|import}`
- `backlog repos {list|show|add|update|remove}` (supports `--url` for cloning)
- `backlog work {add|list|show|move|update|remove|plan|split|import|assign-project|estimate}`
- `backlog task {add|list|show|move|update|remove|block|unblock|plan|estimate|progress}`
- `backlog claim {start|check|finish|list|gc}` (claims gain `expected_finish_at`, `expected_duration_seconds`, `agent_id`; `--duration` and `--agent` flags on `claim start`)
- `backlog schedule {simulate|explain|run}`
- `backlog runs {list|show|gc|interrupt|resume|approve|request-changes|complete|fail|handoff}`
- `backlog agents {list|show|enable|disable|update|validate|health}`
- `backlog sources {add|list|enable|disable|update|remove|validate|sync|push|conflicts|resolve}`
- `backlog orchestrator {start|pause|stop|status|config}`
- `backlog hooks {status|install|uninstall|pause|resume}` (pre-commit hook exports `BACKLOG_PROJECT_DIR` so `claim check` finds the workspace whether `in_repo` or `user_level`)
- `backlog release snapshot`
- `backlog worktree {list|gc}`

### Architecture

- TypeScript + ESM, Node ≥ 20.
- pnpm monorepo: `cli`, `core`, `claims`, `connectors`, `config`, `git`, `hooks`, `schemas`, `server`, `board-ui`. `schemas` is the source of truth (Zod) for cross-boundary types. tsup bundles everything into the published tarball.
- Apache-2.0 (CLI). `@backlog/board-ui` is Apache-2.0; `@backlog/server` is BUSL-1.1 (commercial license for hosted use).

### Notes for users coming from 1.2.0

- npm `latest` now points to `1.3.0`. Reinstall with `npm i -g backlog@latest`.
- No data migration is required; the workspace format hasn't changed since 1.2.0.
