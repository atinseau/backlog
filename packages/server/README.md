# `backlog-server`

Self-hosted backend for the [Backlog CLI](https://www.npmjs.com/package/backlog).

> **Status: scaffold (0.1.0).** Boots, exposes `/health`, but the workspaces, work items, tasks, runs, and source webhook endpoints are still being implemented.

## What this is

Backlog runs locally as a CLI by default. When teams want to share workspaces between machines, ingest from remote sources (GitHub Issues, Linear, etc.), or aggregate run history across users, they need a backend. `backlog-server` is that backend, **self-hosted**.

The hosted SaaS version (Backlog Cloud) is the same API contract, run by Osmove. You can use either.

## License

[BUSL-1.1](./LICENSE) — non-production use is free, self-hosted production use is permitted, hosted commercial competition with Backlog requires a commercial license. The license auto-converts to **Apache-2.0 on 2030-04-25**.

## Quickstart (Docker — easiest)

```sh
docker run -d --name backlog-server \
  -p 3002:3002 \
  -v backlog-server-data:/data \
  ghcr.io/osmove/backlog-server:latest

curl http://127.0.0.1:3002/health
```

Or via `docker compose` from a repo checkout:

```sh
cd packages/server
docker compose up -d
```

## Quickstart (dev mode, from source)

```sh
corepack enable
pnpm install
pnpm --filter backlog-server dev
```

Then:

```sh
curl http://127.0.0.1:3002/health
```

## Quickstart (production, from source)

```sh
pnpm --filter backlog-server build
PORT=3002 node packages/server/dist/index.js
```

## Roadmap

- `/api/v1/auth/*` — local auth
- `/api/v1/workspaces/*` — workspace CRUD + sync
- `/api/v1/work-items/*` — work item sync
- `/api/v1/tasks/*` — task storage
- `/api/v1/runs/*` — run history aggregation
- `/api/v1/sources/webhook/:provider` — GitHub Issues, Linear webhook ingest
- `/api/v1/ai/proxy` — BYOK Anthropic / Codex proxy

See [Backlog Roadmap](../../docs/ROADMAP.md) for the broader open-core plan.
