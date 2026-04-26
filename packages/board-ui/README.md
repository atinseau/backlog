# @backlog/board-ui

Svelte 5 kanban frontend for the local Backlog server. Drag-droppable
work-item cards across **À faire / En cours / In Review / Done**, with an
orchestrator side panel, a claim-creation modal, and an AI-assisted
splitter dialog.

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
corepack pnpm --filter @backlog/board-ui build
```

Output: `../server/dist/public/{index.html,assets/*}`. Re-run after every
change; the dev loop below avoids this.

## Develop

```bash
# Terminal 1 — run the server with the workspace you're hacking on
corepack pnpm --filter @backlog/server dev
# (PORT=7878 by default)

# Terminal 2 — run Vite with /api proxied to the server
corepack pnpm --filter @backlog/board-ui dev
# Opens http://127.0.0.1:5173
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:7878` (override
via `BACKLOG_API_URL`), so SSE, drag-drop, and AI splits all work
end-to-end without rebuilding.

## Layout

```
src/
├── App.svelte              # 4-column shell, SSE wiring, top-bar
├── main.ts                 # Svelte mount
├── app.css                 # 6-line global reset
└── lib/
    ├── Card.svelte           # Work-item card with priority pill, repo chips, RetryBadge
    ├── Column.svelte         # One kanban column with svelte-dnd-action zone
    ├── ClaimDialog.svelte    # Create-a-claim modal with conflict UI
    ├── SplitDialog.svelte    # Manual + AI Suggest tabs
    ├── OrchestratorPanel.svelte  # Side panel: waves + ▶ run button
    ├── RetryBadge.svelte     # Per-second countdown to claim expiry
    ├── api.ts                # Typed wrappers for /api/v1/*
    ├── sse.ts                # EventSource → onEvent + onConnectionChange
    ├── columns.ts            # status → { todo | doing | review | done } map
    └── types.ts              # Shared TS types matching the server's wire shapes
```

## Replacing the UI

The server contract is a small REST + SSE surface (see
[`@backlog/server`](../server/README.md#api)). Anything that speaks
that protocol can replace this package — fork it, build to a different
output directory, point `backlog serve --ui-dist /path/to/your/dist` at
it.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
