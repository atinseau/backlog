# @backlog/server

Local HTTP server that exposes a Backlog project as a REST + SSE API,
serves the Svelte kanban UI, and powers the `backlog serve` command.

[![license: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)

---

## What it is

A self-contained Hono app that reads `.backlog/` directly from disk via the
existing `@backlog/core`, `@backlog/claims`, and `@backlog/config`
packages. No database, no auth, no shared state — each running instance
serves exactly one project, found from the cwd or explicitly via `--project`
(`--workspace` is still accepted as a compatibility alias).

The REST surface is the same primitives the CLI uses; the SSE channel
streams project mutations within ~200ms of the YAML/JSON files
changing on disk.

## Use it via the CLI

The vast majority of users never touch this package directly:

```bash
npm install -g backlog
backlog serve
```

The `backlog` CLI bundles `@backlog/server` (and the `@backlog/board-ui`
build) into its published tarball, so `backlog serve` boots the server,
serves the UI from the same binary, and opens the browser. See the root
[README](../cli/README.md) for the user-facing flow.

## Use it standalone (for hacking the API)

```bash
corepack pnpm install
corepack pnpm --filter @backlog/server dev
# or, to bind a different port / project:
PORT=8080 BACKLOG_WORKSPACE=/path/to/project corepack pnpm --filter @backlog/server dev
```

This runs `tsx --watch src/dev-server.ts`, no UI — hit the API directly.
For UI development, run `corepack pnpm --filter @backlog/board-ui dev`
which serves Vite on `:5173` with `/api` proxied to the server.

## API

All endpoints under `/api/v1/`. JSON in, JSON out (or SSE for `/events`).

### Board, claims, runs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Project path + server version |
| `GET` | `/board?project=...&repo=...` | Tasks grouped into configured columns, including optional Backlog and In Review columns. Cards embed `progress_percent`, `estimate_source`, `elapsed_seconds`, `eta`, `project_id`, `rank`, selected repositories, and active run metadata. |
| `GET` | `/runs?status=...` | Active runs |
| `GET` | `/orchestrate?task=...&subtask=...` | Wave-bucketed execution plan (read-only — no runs are started) |
| `GET` | `/events` | SSE: `claim.changed` / `subtask.changed` / `task.changed` / `run.changed` / `project.changed` / `orchestrator.changed` / `repo.changed`, debounced 200ms |
| `GET` | `/claims` | Active non-expired claims |
| `GET` | `/claims/check?repo=…&path=…` | Is this path free? Returns `retry_after_seconds` if not |
| `POST` | `/claims` | Create a claim. Returns 409 with retry envelope on overlap |
| `DELETE` | `/claims/:id` | Archive a claim |
| `POST` | `/runs` | Launch runs via the existing scheduler/run-launcher pipeline |

### Tasks, subtasks

| Method | Path | Notes |
|---|---|---|
| `POST` | `/tasks` | Create from the kanban (description, project, priority, repositories/workspaces, optional estimate, Git options, AI split options) |
| `POST` | `/tasks/:id/move` | Drag-drop status change |
| `POST` | `/tasks/:id/reorder` | Intra-column reorder (sparse `rank` rewrite) |
| `PATCH` | `/tasks/:id/estimate` | Set or clear the manual estimate |
| `POST` | `/tasks/:id/split` | Mechanical split (one subtask per repository/workspace) |
| `POST` | `/tasks/:id/suggest-split` | AI proposal via Claude (needs `ANTHROPIC_API_KEY`) |
| `POST` | `/tasks/:id/apply-split` | Apply an edited proposal — creates the subtasks |
| `POST` | `/subtasks` | Create a subtask on an existing task |
| `POST` | `/subtasks/:id/move` | Drag-drop status change |
| `POST` | `/subtasks/:id/reorder` | Intra-column reorder (sparse `priority_score` rewrite) |
| `PATCH` | `/subtasks/:id/estimate` | Set or clear the manual estimate |
| `PATCH` | `/tasks/:id/progress` | Agent-reported progress 0..100 |

### Projects, repositories, orchestrator, and agents

| Method | Path | Notes |
|---|---|---|
| `GET` `POST` `PATCH` `DELETE` | `/projects[/:idOrSlug]` | CRUD for projects (groups of repository/workspace ids) |
| `POST` | `/projects/:idOrSlug/archive` | Soft-archive shortcut |
| `GET` `POST` `PATCH` `DELETE` | `/repositories[/:id]` | CRUD for tracked repositories. POST accepts `{ remote_url, remote_type: "git", clone_into? }` to clone first. Legacy `{ git_url }` still works. |
| `GET` | `/orchestrator/state` | Current loop mode + last tick + last error |
| `POST` | `/orchestrator/start` | Body: `{ max_agents?, auto_pick_agents?, tick_interval_ms?, project_id? }` |
| `POST` | `/orchestrator/pause` | Soft pause: stop dispatching, active runs continue |
| `POST` | `/orchestrator/stop` | Wait for active runs to drain, then idle |
| `PATCH` | `/orchestrator/config` | Edit max/auto/tick without changing mode |
| `GET` | `/agents` | Configured agents with active-run counts and full permission fields |
| `PATCH` | `/agents/:id` | Toggle enable, sandbox/success modes, allowed risks/repos, concurrence, model/profile |
| `GET` | `/project` | Project info: name, default branch, autonomy mode, claims policy |
| `PATCH` | `/project/autonomy` | Set autonomy mode (observe / assist / delegate / autopilot) |
| `PATCH` | `/project/claims` | Edit `ttl_minutes` and/or `enforce_on_commit` |

### Claim collision (the interesting one)

`POST /claims` returns **409** when its `paths` overlap an existing
exclusive claim. The body carries everything a blocked agent needs to
back off intelligently:

```json
{
  "error": "claim_overlap",
  "conflict_with": "CLM-...",
  "blocking_topic": "ship-payments",
  "blocking_agent_id": "claude-default",
  "blocking_paths": ["src/auth/login.ts"],
  "blocking_expected_finish_at": "2026-04-26T13:00:00Z",
  "blocking_expires_at": "2026-04-26T13:15:00Z",
  "blocking_status": "active",
  "retry_after_seconds": 1234,
  "retry_after_source": "expected_finish_at"
}
```

`retry_after_seconds` falls back through three tiers — see
`src/lib/retry-after.ts`.

## License

Business Source License 1.1 with an Additional Use Grant covering personal,
internal, evaluation, development, testing, and self-hosted use. Production
use as a commercial hosted service that competes with Backlog requires a
commercial license. **Change Date: 2030-04-25**, after which the code
converts to Apache 2.0 automatically. See [LICENSE](./LICENSE).

The rest of the monorepo (`@backlog/core`, `@backlog/cli`,
`@backlog/board-ui`, schemas, etc.) is Apache 2.0 — only this server
package is BSL.
