# @backlog/server

Local HTTP server that exposes a Backlog workspace as a REST + SSE API,
serves the Svelte kanban UI, and powers the `backlog serve` command.

[![license: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)

---

## What it is

A self-contained Hono app that reads `.backlog/` directly from disk via the
existing `@backlog/core`, `@backlog/claims`, and `@backlog/config`
packages. No database, no auth, no shared state — each running instance
serves exactly one workspace, found via `findWorkspace()` from the cwd or
explicitly via `--workspace`.

The REST surface is the same primitives the CLI uses; the SSE channel
streams workspace mutations within ~200ms of the YAML/JSON files
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
# or, to bind a different port / workspace:
PORT=8080 BACKLOG_WORKSPACE=/path/to/repo corepack pnpm --filter @backlog/server dev
```

This runs `tsx --watch src/dev-server.ts`, no UI — hit the API directly.
For UI development, run `corepack pnpm --filter @backlog/board-ui dev`
which serves Vite on `:5173` with `/api` proxied to the server.

## API

All endpoints under `/api/v1/`. JSON in, JSON out (or SSE for `/events`).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Workspace path + server version |
| `GET` | `/board` | Work items grouped by status into 4 columns, with embedded tasks, claims, and runs |
| `GET` | `/agents` | Configured agents with active-run counts |
| `GET` | `/runs?status=...` | Active runs |
| `GET` | `/orchestrate?work_item=...&task=...` | Wave-bucketed execution plan (read-only — no runs are started) |
| `GET` | `/events` | Server-Sent Events stream: `claim.changed` / `task.changed` / `work_item.changed` / `run.changed`, debounced 200ms |
| `GET` | `/claims` | Active non-expired claims |
| `GET` | `/claims/check?repo=…&path=…` | Is this path free? Returns `retry_after_seconds` if not |
| `POST` | `/claims` | Create a claim. Returns 409 with retry envelope on overlap |
| `DELETE` | `/claims/:id` | Archive a claim |
| `POST` | `/work-items/:id/move` | Drag-drop status change |
| `POST` | `/tasks/:id/move` | Same for tasks |
| `POST` | `/work-items/:id/split` | Mechanical split (one task per repo) |
| `POST` | `/work-items/:id/suggest-split` | AI proposal via Claude (needs `ANTHROPIC_API_KEY`) |
| `POST` | `/work-items/:id/apply-split` | Apply an edited proposal — creates the tasks |
| `POST` | `/runs` | Launch runs via the existing scheduler/run-launcher pipeline |

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
