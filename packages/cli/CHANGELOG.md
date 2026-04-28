# Changelog

All notable changes to the `backlog` CLI are documented here.

## [Unreleased]

### Added — User-level workspace layout

- **`backlog init --user-level`** places the workspace at `~/.backlog/<slug>/`
  instead of `<cwd>/.backlog/`. Right for multi-repo projects that don't have
  a single natural "project root". Single-repo projects still default to
  `in_repo`. Project name uniqueness is enforced across user-level entries.
- **`config.toml` gains `project_location`** (`in_repo` | `user_level`) and
  the user registry's per-entry `location` mirrors it.
- **`~/.backlog/projects.json` is the cross-platform registry path**.
  Existing registries under `~/Library/Application Support/Backlog/` (macOS)
  or `~/.config/Backlog/` (Linux) are auto-migrated on first read.
- **`backlog project migrate <id> --to user-level`** (or `--to in-repo --into
  <repo-id>`) moves an existing workspace between layouts: copies state,
  rewrites `config.toml`, updates the registry, force-reinstalls hooks for
  every configured repo, and renames the old dir to
  `.backlog.migrated-YYYY-MM-DD/` for rollback.
- **The pre-commit hook now exports `BACKLOG_PROJECT_DIR`** so `claim check`
  finds the workspace whether it's in_repo or user_level. The previous
  `cd "$BACKLOG_WORKSPACE"` trick is no longer needed and was removed.

### Added — Jira-like board (projects, persistent orchestrator, ETA, progress, reorder, repos, permissions)

- **Projects** — first-class entity that groups one or many repos. Each work item can carry a `project_id`; the kanban supports per-project filtering. Storage: `.backlog/projects.yaml`. CLI: `backlog project add|list|show|update|archive|remove`. UI: project dropdown + ⚙ "Projets" modal in the topbar.
- **Persistent orchestrator** — start/pause/stop a background loop that re-builds the execution plan and dispatches runs every `tick_interval_ms` (default 5s). Pause is soft: active runs keep going, no new ones launch. Stop waits for actives to drain. Hydrates at server boot only when `last_tick_at < 60s` (no surprise auto-launches). Storage: `.backlog/orchestrator.json`. CLI: `backlog orchestrator start|pause|stop|status|config`. UI: Xcode-style ▶ ⏸ ⏹ trio in the topbar + state pill, plus a slider/auto toggle in the side panel.
- **Live time estimates and progress bars** — every task gets `estimated_duration_seconds` (manual override or median of archived runs filtered by repo+lane, fallback 30 min) plus a derived `progress_percent` (agent-reported > `clamp(elapsed/estimate, 0..0.95)` while running > status-mapped fallback). Work-item progress is a duration-weighted mean. The `/board` payload now exposes `progress_percent`, `eta`, `elapsed_seconds`, `total_estimated_seconds`, `total_remaining_seconds`. UI shows a 4 px progress bar per task with an ETA badge that ticks every second client-side, plus a global ETA pill in the topbar.
- **Drag-to-reorder inside columns** — dragging a card within the same status column rewrites a sparse `priority_score` (work items use a `rank` field). The kanban’s existing cross-column drag still triggers the status change.
- **Repo management UI + API** — new `/api/v1/repos` (GET / POST / PATCH / DELETE) wraps `@backlog/core`'s repo-service so the kanban can list, add, rename, enable, disable, and force-delete repos without dropping to the CLI. Topbar 📁 Repos modal.
- **GitHub / GitLab / Bitbucket / arbitrary Git URL clone** — repos can be added by URL. `RepoConfig` gains optional `git_url` and `provider` (local | github | gitlab | bitbucket | other). `cloneAndAddRepo()` clones into `<workspace>/repos/<id>` by default. Auth follows the user’s local git config (HTTPS token, SSH key). CLI: `backlog repos add --url https://github.com/foo/bar.git`. UI: ⬇ Cloner Git tab in the Repos modal.
- **Permissions screen** — new 🔒 Permissions modal (and `/api/v1/agents` PATCH + `/api/v1/workspace`) lets you toggle the workspace autonomy mode (observe / assist / delegate / autopilot) as a 4-card chooser, edit per-claim TTL and `enforce_on_commit`, and configure each agent (enable, sandbox mode, success mode, concurrence, allowed risks, allowed repos).
- **Ticket and task creation forms** — `+ Ticket` modal in the topbar (title, project, priority, repos, optional manual estimate) and `+` button on each card to add a task without leaving the board.

### Changed

- `/board` now embeds estimates, ETA, progress, and the active project/rank metadata.
- `event-bus` watches `projects.yaml`, `orchestrator.json`, and `config.toml` and emits `project.changed`, `orchestrator.changed`, and `repo.changed` SSE events.
- Schemas: `WorkItem` gets optional `project_id`, `rank`, `estimated_duration_seconds`. `Task` gets optional `estimated_duration_seconds`, `estimate_source`, `progress_percent`. `RepoConfig` gets optional `git_url`, `provider`. All additive — existing YAML continues to parse.
- Tests: 49 → 79 (estimator, progress, project-service, orchestrator-state, orchestrator-loop, reorder).

### Notes

- The repo is a pnpm monorepo. The `backlog` CLI lives in `packages/cli/`. Backlog Cloud (the hosted backend) is a private project and not part of this repo.

## [1.2.0] - 2026-04-26

### Added

- `backlog serve` — local Hono server + Svelte 5 kanban board (BSL 1.1 on the server package, Apache-2.0 on the UI). Boots on `127.0.0.1:7878`, opens the browser, serves the bundled UI from the same `backlog` binary. Cards drag between À faire / En cours / In Review / Done; live updates via SSE on every YAML/JSON mutation in `.backlog/`.
- Orchestrator side panel — wave-bucketed parallel execution plan reusing `buildExecutionPlan` from `@backlog/core`, with a green ▶ button per runnable task that POSTs `/api/v1/runs` and starts the agent.
- Mechanical splitter — ✂ button on every work item with no tasks; modal for repos + scopes + parallel/serial mode + risk.
- AI splitter (optional) — `🤖 Suggest with AI` tab calls Claude (`claude-opus-4-7` by default, overridable via `BACKLOG_AI_MODEL`) with adaptive thinking and a JSON-schema constrained output. Returns an editable proposal; `Apply` creates the tasks. Requires `ANTHROPIC_API_KEY`; degrades gracefully with a clear error when absent.
- Claim creation modal — `+ Claim` button opens a form, server returns 409 with `retry_after_seconds`, `retry_after_source`, and blocking-agent metadata when paths overlap.

### Changed

- `claim` schema gains three optional fields: `expected_finish_at`, `expected_duration_seconds`, `agent_id`. Existing claims parse unchanged. `backlog claim start` accepts `--duration <seconds>` and `--agent <id>`.
- Run-launching logic extracted from `backlog schedule run` into `startRunsForPlan()` in `@backlog/core` so the CLI and the new `POST /api/v1/runs` endpoint share one code path.

### Documentation

- README rewritten for the `npm install -g backlog` flow with a "Run the kanban board" section.
- New per-package READMEs for `@backlog/server` and `@backlog/board-ui`.
- `Dockerfile` + `docker-compose.yml` cleaned up: removed sqlite/SaaS leftovers (`BACKLOG_SERVER_DB_PATH`, port 3002, etc.), default to `127.0.0.1:7878` with the workspace mounted at `/workspace`.

## [1.1.1] - 2026-04-25

### Changed

- Reverts the experimental auth commands (`backlog auth login/logout/status/whoami/signup`) shipped briefly in `1.1.0`. Those commands depended on a `backlog-server` package that has since been removed. `1.1.1` is functionally equivalent to `1.0.3` plus a `zod` dependency bump (3.25.76 → 4.3.6).
- If you installed `1.1.0`, upgrade with `npm i -g backlog@latest`.

## [1.0.3] - 2026-04-25

### Changed

- Aligned `-v, --version` flag with the rest of the osmove CLIs (lowercase). The previous default `-V, --version` (Commander default) still works as legacy.

## [1.0.2] - 2026-04-25

### Changed

- Internal: standardized version flag handling.

## [1.0.1] - 2026-04-25

### Fixed

- `--version` now correctly reflects the published package version. Previously it returned `1.0.0` regardless of the npm version due to a hardcoded constant. Version is now injected at build time by tsup from `package.json#version`.

## [1.0.0] - 2026-04-25

### Added

- First public release of the `backlog` CLI.
- `backlog init` — initialize a workspace in the current directory.
- `backlog doctor` — validate workspace health, detect repo configuration drift.
- `backlog status` — compact workspace summary across configured repos.
- `backlog repos add|list|show|update|remove` — manage tracked repos.
- `backlog work add|list|show|move|update|remove|plan|split|import` — manage normalized work items.
- `backlog task add|list|show|move|update|remove|block|unblock|plan` — manage executable tasks.
- `backlog claim start|check|finish|list|gc` — manage file-scope claims.
- `backlog hooks install|uninstall|status` — install managed git hooks.
- `backlog schedule simulate|explain|run` — plan and execute task scheduling against agents.
- `backlog runs list|show|gc|interrupt|resume|review|approve|request-changes|complete|fail|handoff` — manage agent execution runs.
- `backlog agents list|show|enable|disable|update|validate|health` — manage agent providers (claude, codex, custom).
- `backlog sources add|list|enable|disable|update|remove|validate|sync|push|conflicts|resolve` — manage planning source connectors (markdown, csv, jira).
- `backlog release snapshot` — export per-repo run/dirty state.
- `backlog worktree list|gc` — inspect and clean up tracked worktrees.

### Architecture

- TypeScript + ESM, Node >= 20.
- Bundled via tsup; dependencies inlined for a single-file binary.
- Apache-2.0 license.
