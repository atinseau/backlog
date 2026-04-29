# Legacy Changelog (pre-0.1.0 reset)

> **This file archives the changelog of the `backlog` package as it stood before the April 2026 version reset.**
>
> The `backlog` package was originally published as `1.0.0` in late April 2026 and reached `1.2.0` two days later. That `1.x` labeling implied a stability contract the project was not ready to honor — many subsystems were still in active design. The package was reset to `0.1.0` on 2026-04-28 to reflect honest pre-1.0 status.
>
> The entries below are kept verbatim for historical traceability. None of these versions should be installed; they have been deprecated on npm and largely unpublished. Install `backlog@latest` (>= 0.1.0) instead.

---

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
