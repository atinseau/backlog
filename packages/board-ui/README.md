# @backlog/board-ui

Svelte 5 Jira-like kanban frontend for the local Backlog server. Cards drag
across **Backlog / À faire / En cours / In Review / Done** when those columns
are enabled, and within movable columns to reorder priority. The app shell
carries:

- a **project selector** (with a CRUD modal)
- a selected **agent/model** next to the project name
- topbar **Play / Stop** controls plus a run-status screen; Play is grey when
  configuration is incomplete, white when ready but empty, and blue when a
  task can start
- a **Backlog** section for ideas that are not ready to become tasks
- a **Git** section for Changes, History, branches, worktrees, hooks, and sync
- **Workspaces** management to add a local folder, local Git repository, clone
  from GitHub / GitLab / Bitbucket / arbitrary Git URLs, relocate missing
  checkouts, and update hooks
- **Agents** management with per-agent sandbox / risk / repository restrictions
- a **Runs** section for execution history, ownership, protected paths,
  activity, and token usage
- **Instructions** and **Hooks** sections for coding guidance files and managed
  hook lifecycle
- **+ Task** and **+ Claim** dialogs
- a **total ETA pill** showing remaining work across visible columns

Each task gets a 4 px progress bar and a live ETA badge that ticks every
second client-side while work is active (no server round-trip).

[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](../../LICENSE)

---

## Stack

- Svelte 5 (runes mode)
- Vite 6
- `svelte-dnd-action` for drag-and-drop
- Native `EventSource` for SSE updates
- No state library — `$state` + per-component fetching is enough at this
  scale

Bundle: ~105 KB raw / ~36 KB gzip.

## How it ships

The build output lands in `../server/dist/public/` so `@backlog/server`
picks it up via its static-asset middleware. The CLI's `tsup` config
copies that directory into `packages/cli/dist/public/` at publish time
so end users get UI + API in a single `backlog` install. There is no
separate frontend deployment.

## Build

```bash
pnpm --filter @backlog/board-ui build
```

Output: `../server/dist/public/{index.html,assets/*}`. Re-run after every
change; the dev loop below avoids this.

## Develop

```bash
# Terminal 1 — run the server with the project you're hacking on
pnpm --filter backlog dev serve --project /Users/jimmy/Dev/backlog/backlog-cli --port 7878
# (PORT=7878 by default)

# Terminal 2 — run Vite with /api proxied to the server
pnpm --filter @backlog/board-ui dev
# Opens http://127.0.0.1:5173
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:7878` (override
via `BACKLOG_API_URL`), so SSE, drag-drop, and AI splits all work
end-to-end without rebuilding.

## Layout

```
src/
    ├── App.svelte              # 4-column shell, SSE wiring, app sections
├── main.ts                 # Svelte mount
├── app.css                 # 6-line global reset
└── lib/
    ├── Card.svelte                # Card + per-task progress bar + ETA + add-task button
    ├── Column.svelte              # Kanban column; intra-column drag rewrites rank
    ├── ClaimDialog.svelte         # Create-a-claim modal with conflict UI
    ├── CreateTaskDialog.svelte    # Create a task (description, priority, workspaces, Git/AI options)
    ├── CreateSubTaskDialog.svelte # Create a subtask on an existing task
    ├── CommitsView.svelte         # Git Changes, History, branches, worktrees, sync
    ├── GitDiffPanel.svelte        # User-friendly diff viewer in the right panel
    ├── OrchestratorControls.svelte  # Topbar Play / Stop controls
    ├── OrchestratorPanel.svelte   # Plan internals and diagnostics
    ├── AgentsView.svelte          # Agents + per-agent restrictions
    ├── IntegrationsView.svelte    # GitHub/Jira/source integrations
    ├── ProjectSelector.svelte     # Header dropdown
    ├── ProjectsView.svelte        # CRUD modal for projects
    ├── RepositoriesView.svelte    # Local folders, Git clones, Cloud remote entry point
    ├── RetryBadge.svelte          # Per-second countdown to claim expiry
    ├── SplitDialog.svelte         # Manual + AI Suggest tabs
    ├── timer.svelte.ts            # Reactive 1 Hz now() + format helpers
    ├── api.ts                     # Typed wrappers for /api/v1/*
    ├── sse.ts                     # EventSource → onEvent + onConnectionChange
    ├── columns.ts                 # status → { todo | doing | review | done } map
    └── types.ts                   # Shared TS types matching the server's wire shapes
```

## Replacing the UI

The server contract is a small REST + SSE surface (see
[`@backlog/server`](../server/README.md#api)). Anything that speaks
that protocol can replace this package — fork it, build to a different
output directory, point `backlog serve --ui-dist /path/to/your/dist` at
it.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
