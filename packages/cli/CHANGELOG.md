# Changelog

All notable changes to the `backlog` CLI are documented here.

> **Versioning reset (2026-04-28).** The `backlog` package was previously published as 1.0.0–1.2.0. That `1.x` labeling implied a stability contract the project was not yet ready to honor. The package has been reset to `0.1.0` to reflect honest pre-1.0 status. Breaking changes are expected during the 0.x line; the 1.0.0 milestone has explicit criteria (see `docs/`). Pre-reset entries are archived in `CHANGELOG-LEGACY.md`.

## [Unreleased]

## [0.1.0] - 2026-04-28

First release after the version reset. Contains everything that was in 1.2.0 plus the work that was sitting in Unreleased on the branch.

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
- `backlog hooks {status|install|uninstall}` (pre-commit hook exports `BACKLOG_PROJECT_DIR` so `claim check` finds the workspace whether `in_repo` or `user_level`)
- `backlog release snapshot`
- `backlog worktree {list|gc}`

### Architecture

- TypeScript + ESM, Node ≥ 20.
- pnpm monorepo: `cli`, `core`, `claims`, `connectors`, `config`, `git`, `hooks`, `schemas`, `server`, `board-ui`. `schemas` is the source of truth (Zod) for cross-boundary types. tsup bundles everything into the published tarball.
- Apache-2.0 (CLI). The `@backlog/server` package is BUSL-1.1 (commercial license for hosted use); `@backlog/board-ui` is Apache-2.0.

### Notes for users coming from 1.x

- npm `latest` now points to 0.1.0. If you had `"backlog": "^1.x"` in `package.json` or a Dockerfile, switch to `"^0.1.0"` (or pin to `latest`).
- No data migration is required; the workspace format hasn't changed since 1.2.0.
- Older 1.x versions remain on npm but are deprecated. Reinstall with `npm i -g backlog@latest`.
