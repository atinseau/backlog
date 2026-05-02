# Changelog

All notable changes to `@osmove/backlog-sdk` are documented here.

## [1.3.1] - 2026-05-02

### Changed

- Align the generated OpenAPI contract with Backlog Cloud's public project
  vocabulary: `/projects`, `Project`, and `project_id`.
- Add `updateTask(projectId, taskId, input)` for the existing task patch API.

## [1.3.0] - 2026-04-29

First release under the `@osmove/backlog-sdk` scope, aligned with the wider 1.3.0 ecosystem (CLI + Desktop + SDK). The unscoped `backlog-sdk` package on npm (versions 0.1.0 / 0.2.0) is deprecated with a redirect to this package.

### Added

- TypeScript client generated from the OpenAPI 3.0.3 spec at <https://backlog.so/openapi/v1.yaml>. Types are auto-derived from the contract — schema changes surface as compile errors on consumers.
- `BacklogClient` with bearer-token auth: `signup`, `login`, `logout`, `me`.
- Projects: `listProjects`, `createProject`, `getProject`.
- Tasks: `listTasks`, `createTask`.
- Subtasks: `listSubtasks`, `createSubtask`.
- Runs: `listRuns`, `createRun`.
- Billing: `getBillingConfig`, `getBilling`, `createCheckoutSession`, `createPortalSession`.
- Usage: `getUsage` — month-to-date token spend and remaining quota.
- AI proxy: `aiMessages` — Anthropic Messages passthrough, billed against the project quota.
- Compatibility: the SDK targets the hosted Backlog Cloud contract and self-hosted Cloud deployments.

### Built on

- [`openapi-fetch`](https://www.npmjs.com/package/openapi-fetch) for the runtime client.
- [`openapi-typescript`](https://www.npmjs.com/package/openapi-typescript) for type generation.
- Apache-2.0.
