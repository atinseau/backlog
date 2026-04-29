# Changelog

All notable changes to `@backlog/sdk` are documented here.

## [1.3.0] - 2026-04-29

First release under the `@backlog/sdk` scope, aligned with the wider 1.3.0 ecosystem (CLI + Desktop + SDK).

### Added

- TypeScript client generated from the OpenAPI 3.0.3 spec at <https://backlog.so/openapi/v1.yaml>. Types are auto-derived from the contract — schema changes surface as compile errors on consumers.
- `BacklogClient` with bearer-token auth: `signup`, `login`, `logout`, `me`.
- Workspaces: `listWorkspaces`, `createWorkspace`, `getWorkspace`.
- Work items: `listWorkItems`, `createWorkItem`.
- Tasks: `listTasks`, `createTask`.
- Runs: `listRuns`, `createRun`.
- Billing: `getBillingConfig`, `getBilling`, `createCheckoutSession`, `createPortalSession`.
- Usage: `getUsage` — month-to-date token spend and remaining quota.
- AI proxy: `aiMessages` — Anthropic Messages passthrough, billed against the workspace quota.
- Compatibility: the SDK works against `backlog serve`, the Desktop app, and the hosted Backlog Cloud — all three speak the same OpenAPI 3.0.3 contract.

### Built on

- [`openapi-fetch`](https://www.npmjs.com/package/openapi-fetch) for the runtime client.
- [`openapi-typescript`](https://www.npmjs.com/package/openapi-typescript) for type generation.
- Apache-2.0.
